"""API plans de travaux sauvegardes (tables plans_travaux / plans_travaux_lignes)."""

import re
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from database import get_db


router = APIRouter(prefix="/api", tags=["Plans de travaux"])

SEGMENT_FACILITY_RE = re.compile(r"^(.+?) \((\d+/\d+)\)$")


class PlanLigneIn(BaseModel):
    facilityid: str
    adresse: str | None = None
    materiau: str | None = None
    diametre: float | None = None
    longueur: float = Field(ge=0)
    criticite: float | None = None
    inclus: bool = True
    ordre: int | None = None
    parent_facilityid: str | None = None
    segment_label: str | None = None


class PlanTravauxSaveIn(BaseModel):
    nom: str = Field(min_length=1, max_length=200)
    budget_enveloppe: float = Field(default=0, ge=0)
    tarif_ml: float = Field(default=1000, ge=0)
    note: str | None = None
    items: list[PlanLigneIn] = Field(default_factory=list)


class PlanLigneOut(BaseModel):
    id: int
    ordre: int
    facilityid: str
    parent_facilityid: str | None = None
    segment_label: str | None = None
    adresse: str | None = None
    materiau: str | None = None
    diametre: float | None = None
    longueur: float
    criticite: float | None = None
    inclus: bool


class PlanTravauxListItem(BaseModel):
    id: int
    nom: str
    budget_enveloppe: float
    created_at: str
    updated_at: str | None = None
    tarif_ml: float
    ligne_count: int
    cout_total: float = 0
    budget_depasse: bool | None = None
    saved_at_ms: int | None = None


class PlanTravauxListResponse(BaseModel):
    total: int
    plans: list[PlanTravauxListItem]


class PlanTravauxDetailResponse(BaseModel):
    id: int
    nom: str
    budget_enveloppe: float
    created_at: str
    updated_at: str | None = None
    tarif_ml: float
    note: str | None = None
    items: list[PlanLigneOut]
    saved_at_ms: int | None = None


def _table_exists(cur, name: str) -> bool:
    cur.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
        (name,),
    )
    return cur.fetchone() is not None


def _require_plans_schema(cur) -> None:
    if not _table_exists(cur, "plans_travaux") or not _table_exists(cur, "plans_travaux_lignes"):
        raise HTTPException(
            status_code=503,
            detail="Tables plans_travaux non disponibles. Executez la migration ou le build SQLite.",
        )


def _now_iso() -> str:
    return datetime.now().replace(microsecond=0).isoformat()


def _parse_iso_to_ms(value: str | None) -> int | None:
    if not value:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        dt = datetime.fromisoformat(raw)
        return int(dt.timestamp() * 1000)
    except ValueError:
        return None


def _resolve_segment_fields(item: PlanLigneIn) -> tuple[str, str | None, str | None]:
    parent = item.parent_facilityid
    segment = item.segment_label
    fid = (item.facilityid or "").strip()
    if not parent and not segment:
        match = SEGMENT_FACILITY_RE.match(fid)
        if match:
            return fid, match.group(1), match.group(2)
    return fid, parent, segment


def _replace_plan_lignes(cur, plan_id: int, items: list[PlanLigneIn], tarif_ml: float) -> None:
    cur.execute("DELETE FROM plans_travaux_lignes WHERE plan_id = ?", (plan_id,))
    for index, item in enumerate(items):
        ordre = item.ordre if item.ordre is not None else index + 1
        facilityid, parent, segment = _resolve_segment_fields(item)
        longueur = float(item.longueur or 0)
        cout = round(longueur * tarif_ml, 2) if longueur else None
        cur.execute(
            """
            INSERT INTO plans_travaux_lignes (
                plan_id, ordre, facilityid, parent_facilityid, segment_label,
                adresse, materiau, diametre, longueur, criticite_snapshot, inclus, cout_estime_ml
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                plan_id,
                ordre,
                facilityid,
                parent,
                segment,
                item.adresse,
                item.materiau,
                item.diametre,
                longueur,
                item.criticite,
                1 if item.inclus else 0,
                cout,
            ),
        )


def _fetch_plan_header(cur, plan_id: int):
    cur.execute(
        """
        SELECT id, nom, budget_enveloppe, created_at, updated_at, tarif_ml, note
        FROM plans_travaux
        WHERE id = ?
        """,
        (plan_id,),
    )
    return cur.fetchone()


def _fetch_plan_lignes(cur, plan_id: int) -> list[PlanLigneOut]:
    cur.execute(
        """
        SELECT
            id, ordre, facilityid, parent_facilityid, segment_label,
            adresse, materiau, diametre, longueur, criticite_snapshot, inclus
        FROM plans_travaux_lignes
        WHERE plan_id = ?
        ORDER BY ordre ASC, id ASC
        """,
        (plan_id,),
    )
    lignes: list[PlanLigneOut] = []
    for row in cur.fetchall():
        lignes.append(
            PlanLigneOut(
                id=int(row["id"]),
                ordre=int(row["ordre"]),
                facilityid=row["facilityid"],
                parent_facilityid=row["parent_facilityid"],
                segment_label=row["segment_label"],
                adresse=row["adresse"],
                materiau=row["materiau"],
                diametre=row["diametre"],
                longueur=float(row["longueur"] or 0),
                criticite=row["criticite_snapshot"],
                inclus=bool(row["inclus"]),
            )
        )
    return lignes


def _plan_to_detail(row) -> PlanTravauxDetailResponse:
    created_at = row["created_at"] or ""
    updated_at = row["updated_at"] or None
    reference_date = updated_at or created_at
    return PlanTravauxDetailResponse(
        id=int(row["id"]),
        nom=row["nom"] or "Plan sans nom",
        budget_enveloppe=float(row["budget_enveloppe"] or 0),
        created_at=created_at,
        updated_at=updated_at,
        tarif_ml=float(row["tarif_ml"] or 1000),
        note=row["note"],
        items=[],
        saved_at_ms=_parse_iso_to_ms(reference_date),
    )


@router.get("/plans-travaux", response_model=PlanTravauxListResponse)
def list_plans_travaux():
    """Liste des plans sauvegardes (ecran « Ouvrir un plan »)."""
    conn = get_db()
    cur = conn.cursor()

    if not _table_exists(cur, "plans_travaux"):
        conn.close()
        return PlanTravauxListResponse(total=0, plans=[])

    has_lignes = _table_exists(cur, "plans_travaux_lignes")
    ligne_count_sql = (
        "(SELECT COUNT(*) FROM plans_travaux_lignes l WHERE l.plan_id = p.id)"
        if has_lignes
        else "0"
    )
    cout_total_sql = (
        """
        (SELECT COALESCE(SUM(ROUND(l.longueur * p.tarif_ml, 2)), 0)
         FROM plans_travaux_lignes l
         WHERE l.plan_id = p.id AND l.inclus = 1)
        """
        if has_lignes
        else "0"
    )

    cur.execute(
        f"""
        SELECT
            p.id, p.nom, p.budget_enveloppe,
            p.created_at, p.updated_at, p.tarif_ml,
            {ligne_count_sql} AS ligne_count,
            {cout_total_sql} AS cout_total
        FROM plans_travaux p
        ORDER BY COALESCE(p.updated_at, p.created_at) DESC, p.id DESC
        """
    )

    plans: list[PlanTravauxListItem] = []
    for row in cur.fetchall():
        created_at = row["created_at"]
        updated_at = row["updated_at"] or None
        reference_date = updated_at or created_at
        budget = float(row["budget_enveloppe"] or 0)
        cout_total = float(row["cout_total"] or 0)
        budget_depasse = None
        if budget > 0:
            budget_depasse = cout_total > budget
        plans.append(
            PlanTravauxListItem(
                id=int(row["id"]),
                nom=row["nom"] or "Plan sans nom",
                budget_enveloppe=budget,
                created_at=created_at or "",
                updated_at=updated_at,
                tarif_ml=float(row["tarif_ml"] or 1000),
                ligne_count=int(row["ligne_count"] or 0),
                cout_total=cout_total,
                budget_depasse=budget_depasse,
                saved_at_ms=_parse_iso_to_ms(reference_date),
            )
        )

    conn.close()
    return PlanTravauxListResponse(total=len(plans), plans=plans)


@router.get("/plans-travaux/{plan_id}", response_model=PlanTravauxDetailResponse)
def get_plan_travaux(plan_id: int):
    """Detail d'un plan (en-tete + lignes) pour reouverture."""
    conn = get_db()
    cur = conn.cursor()
    _require_plans_schema(cur)

    row = _fetch_plan_header(cur, plan_id)
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Plan introuvable")

    detail = _plan_to_detail(row)
    detail.items = _fetch_plan_lignes(cur, plan_id)
    conn.close()
    return detail


@router.post("/plans-travaux", response_model=PlanTravauxDetailResponse, status_code=201)
def create_plan_travaux(body: PlanTravauxSaveIn):
    """Cree un nouveau plan sauvegarde (premiere enregistrement)."""
    conn = get_db()
    cur = conn.cursor()
    _require_plans_schema(cur)
    cur.execute("PRAGMA foreign_keys = ON")

    nom = body.nom.strip()
    if not nom:
        conn.close()
        raise HTTPException(status_code=400, detail="Le nom du plan est obligatoire")

    created = _now_iso()
    note = (body.note or "").strip() or None
    cur.execute(
        """
        INSERT INTO plans_travaux (
            nom, budget_enveloppe, created_at, updated_at, tarif_ml, note
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        (nom, body.budget_enveloppe, created, created, body.tarif_ml, note),
    )
    plan_id = int(cur.lastrowid)
    _replace_plan_lignes(cur, plan_id, body.items, body.tarif_ml)
    conn.commit()

    row = _fetch_plan_header(cur, plan_id)
    detail = _plan_to_detail(row)
    detail.items = _fetch_plan_lignes(cur, plan_id)
    conn.close()
    return detail


@router.put("/plans-travaux/{plan_id}", response_model=PlanTravauxDetailResponse)
def update_plan_travaux(plan_id: int, body: PlanTravauxSaveIn):
    """Met a jour un plan deja sauvegarde (re-enregistrement sans changer le nom affiche)."""
    conn = get_db()
    cur = conn.cursor()
    _require_plans_schema(cur)
    cur.execute("PRAGMA foreign_keys = ON")

    row = _fetch_plan_header(cur, plan_id)
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Plan introuvable")

    nom = body.nom.strip() or row["nom"]
    updated = _now_iso()
    note = (body.note or "").strip() or None
    cur.execute(
        """
        UPDATE plans_travaux
        SET nom = ?, budget_enveloppe = ?, updated_at = ?, tarif_ml = ?, note = ?
        WHERE id = ?
        """,
        (nom, body.budget_enveloppe, updated, body.tarif_ml, note, plan_id),
    )
    _replace_plan_lignes(cur, plan_id, body.items, body.tarif_ml)
    conn.commit()

    row = _fetch_plan_header(cur, plan_id)
    detail = _plan_to_detail(row)
    detail.items = _fetch_plan_lignes(cur, plan_id)
    conn.close()
    return detail


def _duplicate_plan_nom(original: str) -> str:
    base = (original or "Plan sans nom").strip()
    suffix = " (copie)"
    max_len = 200
    if len(base) + len(suffix) <= max_len:
        return base + suffix
    return base[: max_len - len(suffix)] + suffix


@router.post(
    "/plans-travaux/{plan_id}/duplicate",
    response_model=PlanTravauxDetailResponse,
    status_code=201,
)
def duplicate_plan_travaux(plan_id: int):
    """Duplique un plan sauvegarde (en-tete + lignes)."""
    conn = get_db()
    cur = conn.cursor()
    _require_plans_schema(cur)
    cur.execute("PRAGMA foreign_keys = ON")

    row = _fetch_plan_header(cur, plan_id)
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Plan introuvable")

    created = _now_iso()
    nom = _duplicate_plan_nom(row["nom"])
    cur.execute(
        """
        INSERT INTO plans_travaux (
            nom, budget_enveloppe, created_at, updated_at, tarif_ml, note
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            nom,
            float(row["budget_enveloppe"] or 0),
            created,
            created,
            float(row["tarif_ml"] or 1000),
            row["note"],
        ),
    )
    new_plan_id = int(cur.lastrowid)
    cur.execute(
        """
        INSERT INTO plans_travaux_lignes (
            plan_id, ordre, facilityid, parent_facilityid, segment_label,
            adresse, materiau, diametre, longueur, criticite_snapshot, inclus, cout_estime_ml
        )
        SELECT
            ?, ordre, facilityid, parent_facilityid, segment_label,
            adresse, materiau, diametre, longueur, criticite_snapshot, inclus, cout_estime_ml
        FROM plans_travaux_lignes
        WHERE plan_id = ?
        ORDER BY ordre ASC, id ASC
        """,
        (new_plan_id, plan_id),
    )
    conn.commit()

    new_row = _fetch_plan_header(cur, new_plan_id)
    detail = _plan_to_detail(new_row)
    detail.items = _fetch_plan_lignes(cur, new_plan_id)
    conn.close()
    return detail


@router.delete("/plans-travaux/{plan_id}", status_code=204)
def delete_plan_travaux(plan_id: int):
    """Supprime un plan et ses lignes (CASCADE)."""
    conn = get_db()
    cur = conn.cursor()
    _require_plans_schema(cur)
    cur.execute("PRAGMA foreign_keys = ON")

    row = _fetch_plan_header(cur, plan_id)
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Plan introuvable")

    cur.execute("DELETE FROM plans_travaux WHERE id = ?", (plan_id,))
    conn.commit()
    conn.close()

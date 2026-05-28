from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from database import get_db


router = APIRouter(prefix="/api", tags=["Chantiers"])


class ChantierAdresseUpdate(BaseModel):
    num_op: str
    adresse: str


@router.get("/chantiers")
def get_chantiers(
    commune: str = Query(default=""),
    etat: str = Query(default=""),
    search: str = Query(default=""),
    only_missing_adresse: bool = Query(default=False),
    limit: int = Query(default=100),
    offset: int = Query(default=0),
):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("PRAGMA table_info(chantiers)")
    col_names = {r[1] for r in cur.fetchall()}
    has_adresse = "adresse" in col_names

    filters = ["1=1"]
    params = []

    if commune:
        filters.append("LOWER(commune) LIKE LOWER(?)")
        params.append(f"%{commune}%")

    if etat:
        filters.append("etat = ?")
        params.append(etat)

    if search:
        if has_adresse:
            filters.append("(CAST(num_op AS TEXT) LIKE ? OR LOWER(COALESCE(adresse,'')) LIKE LOWER(?))")
            params.extend([f"%{search}%", f"%{search}%"])
        else:
            filters.append("CAST(num_op AS TEXT) LIKE ?")
            params.append(f"%{search}%")

    if only_missing_adresse and has_adresse:
        filters.append("(adresse IS NULL OR TRIM(adresse) = '')")

    where = " AND ".join(filters)

    select_cols = "num_op, etat, date_debut, date_fin, commune, libelle"
    if has_adresse:
        select_cols += ", adresse"

    missing_count = 0
    if has_adresse:
        cur.execute("SELECT COUNT(*) FROM chantiers WHERE (adresse IS NULL OR TRIM(adresse) = '')")
        missing_count = cur.fetchone()[0]

    cur.execute(f"SELECT COUNT(*) FROM chantiers WHERE {where}", params)
    total = cur.fetchone()[0]

    cur.execute(
        f"""
        SELECT {select_cols}
        FROM chantiers
        WHERE {where}
        ORDER BY date_debut ASC
        LIMIT ? OFFSET ?
        """,
        params + [limit, offset],
    )

    rows = [dict(r) for r in cur.fetchall()]
    conn.close()

    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "missing_count": missing_count,
        "chantiers": rows,
    }


@router.patch("/chantiers/adresse")
def update_chantier_adresse(payload: ChantierAdresseUpdate):
    num_op = (payload.num_op or "").strip()
    adresse = (payload.adresse or "").strip()
    if not num_op:
        raise HTTPException(status_code=400, detail="num_op manquant")
    if not adresse:
        raise HTTPException(status_code=400, detail="adresse manquante")

    conn = get_db()
    cur = conn.cursor()
    try:
        cur.execute("PRAGMA table_info(chantiers)")
        col_names = {r[1] for r in cur.fetchall()}
        if "adresse" not in col_names:
            raise HTTPException(status_code=500, detail="La colonne adresse n'existe pas dans chantiers")

        cur.execute(
            """
            UPDATE chantiers
            SET adresse = ?
            WHERE num_op = ?
            """,
            (adresse, num_op),
        )
        updated = cur.rowcount
        if updated <= 0:
            raise HTTPException(status_code=404, detail="Aucun chantier trouve pour ce num_op")
        conn.commit()
    finally:
        conn.close()

    return {"ok": True, "updated": updated, "num_op": num_op, "adresse": adresse}
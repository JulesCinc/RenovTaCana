from fastapi import APIRouter, Query

from database import get_db
from utils import normalize_text


router = APIRouter(prefix="/api", tags=["Canalisations"])


ALLOWED_SORT_COLS = {
    "facilityid",
    "adresse",
    "materiau",
    "diametre",
    "longueur",
    "annee_pose",
    "nb_fuites",
    "criticite",
    "anciennete",
    "score_priorite",
}


@router.get("/canalisations")
def get_canalisations(
    adresse: str = Query(default=""),
    commune: str = Query(default=""),
    materiau: str = Query(default=""),
    anciennete: str = Query(default=""),
    statut: str = Query(default=""),
    search: str = Query(default=""),
    crit_min: float = Query(default=0),
    crit_max: float = Query(default=100),
    sort_col: str = Query(default="score_priorite"),
    sort_dir: str = Query(default="desc"),
    limit: int = Query(default=100),
    offset: int = Query(default=0),
):
    conn = get_db()
    cur = conn.cursor()

    filters = ["1=1"]
    params = []

    if adresse:
        filters.append("LOWER(adresse) LIKE LOWER(?)")
        params.append(f"%{adresse}%")

    if commune:
        filters.append("LOWER(commune) LIKE LOWER(?)")
        params.append(f"%{commune}%")

    if materiau:
        filters.append("materiau = ?")
        params.append(materiau)

    if anciennete:
        filters.append("anciennete = ?")
        params.append(anciennete)

    if search:
        filters.append("LOWER(facilityid) LIKE LOWER(?)")
        params.append(f"%{search}%")

    if statut == "critique":
        filters.append("criticite >= 70")
    elif statut == "attention":
        filters.append("criticite >= 40 AND criticite < 70")
    elif statut == "bon":
        filters.append("(criticite < 40 OR criticite IS NULL)")

    filters.append("(criticite IS NULL OR (criticite >= ? AND criticite <= ?))")
    params += [crit_min, crit_max]

    where = " AND ".join(filters)
    col = sort_col if sort_col in ALLOWED_SORT_COLS else "score_priorite"
    direction = "DESC" if sort_dir == "desc" else "ASC"

    cur.execute(f"SELECT COUNT(*) FROM canalisations WHERE {where}", params)
    total = cur.fetchone()[0]

    cur.execute(
        f"""
        SELECT facilityid, adresse, commune, materiau, diametre, longueur,
               annee_pose, nb_fuites, vetuste, categorie, anciennete,
               densite, criticite, score_priorite
        FROM canalisations
        WHERE {where}
        ORDER BY {col} {direction} NULLS LAST
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
        "canalisations": rows,
    }


@router.get("/adresses/suggestions")
def get_adresse_suggestions(
    q: str = Query(default=""),
    limit: int = Query(default=5, ge=1, le=10),
):
    normalized_query = normalize_text(q)

    if len(normalized_query) < 2:
        return {"query": q, "suggestions": []}

    conn = get_db()
    cur = conn.cursor()

    cur.execute(
        """
        WITH base AS (
            SELECT
                adresse,
                commune,
                COUNT(*) AS nb,
                normalize_text(adresse) AS n_adresse,
                normalize_text(COALESCE(commune, '')) AS n_commune,
                normalize_text(adresse || ' ' || COALESCE(commune, '')) AS n_full
            FROM canalisations
            WHERE adresse != ''
            GROUP BY adresse, commune
        ),
        q AS (
            SELECT normalize_text(?) AS nq
        ),
        scored AS (
            SELECT
                b.adresse,
                b.commune,
                b.nb,
                CASE
                    WHEN b.n_adresse = q.nq OR b.n_full = q.nq THEN 0
                    WHEN b.n_adresse LIKE q.nq || '%' THEN 1
                    WHEN b.n_full LIKE q.nq || '%' THEN 2
                    WHEN INSTR(b.n_adresse, ' ' || q.nq) > 0 THEN 3
                    WHEN INSTR(b.n_full, ' ' || q.nq) > 0 THEN 4
                    WHEN INSTR(b.n_adresse, q.nq) > 0 THEN 5
                    WHEN INSTR(b.n_full, q.nq) > 0 THEN 6
                    ELSE 9
                END AS score,
                CASE
                    WHEN INSTR(b.n_adresse, q.nq) = 0 THEN 9999
                    ELSE INSTR(b.n_adresse, q.nq)
                END AS pos
            FROM base b
            CROSS JOIN q
            WHERE b.n_full LIKE '%' || q.nq || '%'
               OR b.n_adresse LIKE '%' || q.nq || '%'
               OR b.n_commune LIKE '%' || q.nq || '%'
        )
        SELECT adresse, commune, nb
        FROM scored
        ORDER BY score ASC, pos ASC, LENGTH(adresse) ASC, nb DESC
        LIMIT ?
        """,
        (q, limit),
    )

    suggestions = []

    for row in cur.fetchall():
        adresse = row["adresse"] or ""
        commune = row["commune"] or ""
        full_label = f"{adresse}, {commune}" if commune else adresse

        suggestions.append(
            {
                "adresse": adresse,
                "commune": commune,
                "label": full_label,
                "count": row["nb"],
            }
        )

    conn.close()

    return {"query": q, "suggestions": suggestions}


@router.post("/canalisations/zone")
def get_canalisations_zone(payload: dict):
    ids = payload.get("ids", [])
    limit = int(payload.get("limit", 100))
    offset = int(payload.get("offset", 0))

    if not ids:
        return {"total": 0, "canalisations": []}

    conn = get_db()
    cur = conn.cursor()

    ph = ",".join("?" * len(ids))

    cur.execute(
        f"SELECT COUNT(*) FROM canalisations WHERE facilityid IN ({ph})",
        ids,
    )
    total = cur.fetchone()[0]

    cur.execute(
        f"""
        SELECT facilityid, adresse, commune, materiau, diametre, longueur,
               annee_pose, nb_fuites, vetuste, categorie, anciennete,
               densite, criticite, score_priorite
        FROM canalisations
        WHERE facilityid IN ({ph})
        ORDER BY score_priorite DESC NULLS LAST
        LIMIT ? OFFSET ?
        """,
        ids + [limit, offset],
    )

    rows = [dict(r) for r in cur.fetchall()]
    conn.close()

    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "canalisations": rows,
    }
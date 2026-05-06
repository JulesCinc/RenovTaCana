from fastapi import APIRouter, Query

from database import get_db


router = APIRouter(prefix="/api", tags=["Plan travaux"])


@router.get("/plan-travaux")
def get_plan_travaux(
    commune: str = Query(default=""),
    limit: int = Query(default=50),
    offset: int = Query(default=0),
):
    conn = get_db()
    cur = conn.cursor()

    filters = ["adresse != ''", "criticite IS NOT NULL"]
    params = []

    if commune:
        filters.append("LOWER(commune) LIKE LOWER(?)")
        params.append(f"%{commune}%")

    where = " AND ".join(filters)

    cur.execute(
        f"""
        SELECT COUNT(DISTINCT adresse || commune)
        FROM (
            SELECT adresse, commune
            FROM canalisations
            WHERE {where}
        )
        """,
        params,
    )
    total = cur.fetchone()[0]

    cur.execute(
        f"""
        SELECT adresse, commune,
               COUNT(*) as nb_canalisations,
               ROUND(AVG(criticite),1) as crit_moy,
               ROUND(MAX(score_priorite),1) as score_max,
               CAST(SUM(nb_fuites) AS INTEGER) as total_fuites,
               ROUND(SUM(longueur),0) as longueur_tot,
               GROUP_CONCAT(DISTINCT materiau) as materiaux,
               MIN(annee_pose) as plus_ancienne
        FROM canalisations
        WHERE {where}
        GROUP BY adresse, commune
        ORDER BY score_max DESC
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
        "rues": rows,
    }
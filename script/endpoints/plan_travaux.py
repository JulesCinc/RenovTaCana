from fastapi import APIRouter, Query
from database import get_db

router = APIRouter(prefix="/api", tags=["Plan travaux"])


def normalize_col(col_name: str) -> str:
    return (
        f"REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE("
        f"LOWER(TRIM({col_name})), "
        f"'é', 'e'), 'è', 'e'), 'ê', 'e'), 'ë', 'e'), "
        f"'à', 'a'), 'â', 'a'), 'ä', 'a'), "
        f"'ô', 'o'), 'ö', 'o'), "
        f"'î', 'i'), 'ï', 'i'), "
        f"'û', 'u'), 'ü', 'u'), "
        f"'ç', 'c')"
    )


@router.get("/plan-travaux")
def get_plan_travaux(
    commune: str = Query(default=""),
    limit: int = Query(default=50),
    offset: int = Query(default=0),
):
    conn = get_db()
    cur = conn.cursor()

    # Filtres de base
    filters = ["adresse != ''", "criticite IS NOT NULL"]
    params = []

    if commune:
        filters.append("LOWER(commune) LIKE LOWER(?)")
        params.append(f"%{commune}%")

    where = " AND ".join(filters)

    norm_canal = normalize_col("canalisations.adresse")
    norm_chantier = normalize_col("c.adresse")
    norm_operation = normalize_col("o.localisation")

    priority_score = f"""
    CASE
        WHEN adresse IS NOT NULL AND adresse != ''
             AND EXISTS (
                SELECT 1 FROM chantiers c
                WHERE c.etat NOT IN ('Terminé', 'Annulé')
                  AND (
                      (c.date_debut <= date('now') AND c.date_fin >= date('now'))
                      OR c.date_debut <= date('now')
                  )
                  AND {norm_chantier} = {norm_canal}
             )
             AND EXISTS (
                SELECT 1 FROM operations o
                WHERE o.annee >= strftime('%Y', 'now')
                  AND {norm_operation} = {norm_canal}
             )
        THEN (criticite * 0.8) + 0.2

        WHEN adresse IS NOT NULL AND adresse != ''
             AND EXISTS (
                SELECT 1 FROM chantiers c
                WHERE c.etat NOT IN ('Terminé', 'Annulé')
                  AND (
                      (c.date_debut <= date('now') AND c.date_fin >= date('now'))
                      OR c.date_debut <= date('now')
                  )
                  AND {norm_chantier} = {norm_canal}
             )
        THEN (criticite * 0.8) + 0.1

        WHEN adresse IS NOT NULL AND adresse != ''
             AND EXISTS (
                SELECT 1 FROM operations o
                WHERE o.annee >= strftime('%Y', 'now')
                  AND {norm_operation} = {norm_canal}
             )
        THEN (criticite * 0.8) + 0.1

        ELSE criticite * 0.8
    END
    """

    # Compte total des adresses uniques
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
               ROUND(AVG({priority_score}),2) as score_max,
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

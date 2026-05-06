from fastapi import APIRouter, Query

from database import get_db


router = APIRouter(prefix="/api", tags=["Stats"])


@router.get("/stats")
def get_stats():
    conn = get_db()
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) FROM canalisations")
    total = cur.fetchone()[0]

    cur.execute("SELECT AVG(criticite) FROM canalisations WHERE criticite IS NOT NULL")
    moy_crit = round(cur.fetchone()[0] or 0, 1)

    cur.execute("SELECT COUNT(*) FROM canalisations WHERE criticite >= 70")
    critiques = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM canalisations WHERE criticite >= 40 AND criticite < 70")
    attention = cur.fetchone()[0]

    cur.execute("SELECT SUM(longueur)/1000 FROM canalisations WHERE longueur IS NOT NULL")
    km_total = round(cur.fetchone()[0] or 0, 1)

    cur.execute("SELECT COUNT(*) FROM chantiers")
    nb_chantiers = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM chantiers WHERE etat = 'Planifié'")
    chantiers_planifies = cur.fetchone()[0]

    cur.execute(
        """
        SELECT materiau, COUNT(*) as n
        FROM canalisations
        WHERE materiau != ''
        GROUP BY materiau
        ORDER BY n DESC
        LIMIT 6
        """
    )
    materiaux = [
        {"nom": r[0], "count": r[1]}
        for r in cur.fetchall()
    ]

    cur.execute(
        """
        SELECT
            CASE
                WHEN criticite >= 70 THEN 'Critique'
                WHEN criticite >= 40 THEN 'Attention'
                WHEN criticite IS NOT NULL THEN 'Bon état'
                ELSE 'Non évalué'
            END as niveau,
            COUNT(*) as n
        FROM canalisations
        GROUP BY niveau
        """
    )
    repartition = [
        {"niveau": r[0], "count": r[1]}
        for r in cur.fetchall()
    ]

    conn.close()

    return {
        "total_canalisations": total,
        "km_total": km_total,
        "criticite_moyenne": moy_crit,
        "critiques": critiques,
        "attention": attention,
        "nb_chantiers": nb_chantiers,
        "chantiers_planifies": chantiers_planifies,
        "materiaux": materiaux,
        "repartition_criticite": repartition,
    }


@router.get("/stats/adresse")
def get_stats_adresse(adresse: str = Query(default="")):
    if not adresse:
        return {}

    conn = get_db()
    cur = conn.cursor()

    cur.execute(
        """
        SELECT COUNT(*),
               AVG(criticite),
               SUM(longueur),
               MAX(criticite),
               COUNT(CASE WHEN criticite >= 70 THEN 1 END),
               SUM(nb_fuites)
        FROM canalisations
        WHERE LOWER(adresse) LIKE LOWER(?)
        """,
        (f"%{adresse}%",),
    )

    r = cur.fetchone()
    conn.close()

    return {
        "nb_canalisations": r[0],
        "criticite_moyenne": round(r[1] or 0, 1),
        "longueur_totale": round(r[2] or 0, 1),
        "criticite_max": round(r[3] or 0, 1),
        "critiques": r[4] or 0,
        "nb_fuites_total": int(r[5] or 0),
    }
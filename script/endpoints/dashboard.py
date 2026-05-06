from fastapi import APIRouter

from database import get_db


router = APIRouter(prefix="/api", tags=["Dashboard"])


@router.get("/dashboard")
def get_dashboard():
    conn = get_db()
    cur = conn.cursor()

    cur.execute(
        """
        SELECT COUNT(*), SUM(longueur)/1000, AVG(criticite), SUM(nb_fuites)
        FROM canalisations
        """
    )
    r = cur.fetchone()

    total = r[0]
    km = round(r[1] or 0, 1)
    moy_crit = round(r[2] or 0, 1)
    total_fuites = int(r[3] or 0)

    cur.execute("SELECT COUNT(*) FROM canalisations WHERE criticite >= 70")
    critiques = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM canalisations WHERE criticite >= 40 AND criticite < 70")
    attention = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM canalisations WHERE criticite < 40 AND criticite IS NOT NULL")
    bon = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM canalisations WHERE criticite IS NULL")
    non_eval = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM chantiers")
    nb_chantiers = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM chantiers WHERE etat='Planifié'")
    planifies = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM chantiers WHERE etat='Validé en planification'")
    valides = cur.fetchone()[0]

    cur.execute(
        """
        SELECT materiau, COUNT(*) as n, ROUND(AVG(criticite),1) as moy
        FROM canalisations
        WHERE materiau != ''
        GROUP BY materiau
        ORDER BY n DESC
        LIMIT 8
        """
    )
    materiaux = [
        {"nom": r[0], "count": r[1], "crit_moy": r[2]}
        for r in cur.fetchall()
    ]

    cur.execute(
        """
        SELECT
            CASE
                WHEN annee_pose < 1950 THEN 'Avant 1950'
                WHEN annee_pose < 1970 THEN '1950–1969'
                WHEN annee_pose < 1990 THEN '1970–1989'
                WHEN annee_pose < 2000 THEN '1990–1999'
                WHEN annee_pose < 2010 THEN '2000–2009'
                WHEN annee_pose IS NOT NULL THEN '2010+'
                ELSE 'Inconnue'
            END as periode,
            COUNT(*) as n,
            ROUND(AVG(criticite),1) as moy_crit
        FROM canalisations
        GROUP BY periode
        ORDER BY periode
        """
    )
    annees = [
        {"periode": r[0], "count": r[1], "crit_moy": r[2]}
        for r in cur.fetchall()
    ]

    cur.execute(
        """
        SELECT adresse, commune,
               COUNT(*) as nb,
               ROUND(AVG(criticite),1) as crit_moy,
               ROUND(MAX(score_priorite),1) as score_max,
               SUM(nb_fuites) as fuites,
               ROUND(SUM(longueur),0) as longueur
        FROM canalisations
        WHERE adresse != '' AND criticite IS NOT NULL
        GROUP BY adresse, commune
        ORDER BY score_max DESC
        LIMIT 15
        """
    )
    top_rues = [
        {
            "adresse": r[0],
            "commune": r[1],
            "nb": r[2],
            "crit_moy": r[3],
            "score": r[4],
            "fuites": r[5],
            "longueur": r[6],
        }
        for r in cur.fetchall()
    ]

    cur.execute("SELECT etat, COUNT(*) FROM chantiers GROUP BY etat")
    chantiers_etat = [
        {"etat": r[0], "count": r[1]}
        for r in cur.fetchall()
    ]

    conn.close()

    return {
        "total_canalisations": total,
        "km_total": km,
        "criticite_moyenne": moy_crit,
        "total_fuites": total_fuites,
        "critiques": critiques,
        "attention": attention,
        "bon": bon,
        "non_eval": non_eval,
        "nb_chantiers": nb_chantiers,
        "planifies": planifies,
        "valides": valides,
        "materiaux": materiaux,
        "annees": annees,
        "top_rues": top_rues,
        "chantiers_etat": chantiers_etat,
    }
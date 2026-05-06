from fastapi import APIRouter

from database import get_db


router = APIRouter(prefix="/api", tags=["Filtres"])


@router.get("/filtres")
def get_filtres():
    conn = get_db()
    cur = conn.cursor()

    cur.execute(
        """
        SELECT DISTINCT materiau
        FROM canalisations
        WHERE materiau != ''
        ORDER BY materiau
        """
    )
    materiaux = [r[0] for r in cur.fetchall()]

    cur.execute(
        """
        SELECT DISTINCT commune
        FROM canalisations
        WHERE commune != ''
        ORDER BY commune
        """
    )
    communes = [r[0] for r in cur.fetchall()]

    cur.execute(
        """
        SELECT DISTINCT anciennete
        FROM canalisations
        WHERE anciennete != ''
        ORDER BY anciennete
        """
    )
    anciennetes = [r[0] for r in cur.fetchall()]

    conn.close()

    return {
        "materiaux": materiaux,
        "communes": communes,
        "anciennetes": anciennetes,
    }
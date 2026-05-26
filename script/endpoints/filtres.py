import os
import sys

from fastapi import APIRouter

from database import get_db

_build_sqlite_dir = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "database", "build-sqlite")
)
if _build_sqlite_dir not in sys.path:
    sys.path.insert(0, _build_sqlite_dir)

from communes_lookup import commune_names_for_codes, normalize_commune_code


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
    names = commune_names_for_codes(cur, communes)
    communes_options = []
    for c in communes:
        code = normalize_commune_code(c)
        if not code:
            label = ""
        elif not code.isdigit():
            label = str(c).strip() or code
        else:
            label = names.get(code) or code
        communes_options.append({"value": c, "label": label})

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
        "communes_options": communes_options,
        "anciennetes": anciennetes,
    }

import json
from functools import lru_cache
from urllib.error import URLError
from urllib.request import urlopen

from fastapi import APIRouter

from database import get_db


router = APIRouter(prefix="/api", tags=["Filtres"])


def normalize_commune_code(value):
    code = str(value or "").strip()
    if not code:
        return ""
    if code.isdigit() and len(code) == 4:
        return f"0{code}"
    return code


@lru_cache(maxsize=1024)
def fetch_commune_name_from_code(code):
    if not code.isdigit() or len(code) != 5:
        return None
    url = f"https://geo.api.gouv.fr/communes/{code}?fields=nom&format=json&geometry=centre"
    try:
        with urlopen(url, timeout=2.0) as response:
            payload = json.loads(response.read().decode("utf-8"))
            if isinstance(payload, dict):
                name = str(payload.get("nom") or "").strip()
                return name or None
    except (TimeoutError, URLError, ValueError, json.JSONDecodeError):
        return None
    return None


def commune_display_value(raw_value):
    code = normalize_commune_code(raw_value)
    if not code:
        return ""
    if not code.isdigit():
        return code
    return fetch_commune_name_from_code(code) or code


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
    communes_options = [
        {"value": c, "label": commune_display_value(c)}
        for c in communes
    ]

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
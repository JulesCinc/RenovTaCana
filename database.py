import os
import sqlite3
from pathlib import Path

from script.utils import normalize_text


BASE_DIR = os.path.dirname(__file__)
DB_DIR = Path(BASE_DIR) / "database"
DB_CANDIDATES = [
    DB_DIR / "renovTaCana.db",
    DB_DIR / "renovtacana.db",
]


def _resolve_db_path() -> str:
    for candidate in DB_CANDIDATES:
        if candidate.exists():
            return str(candidate)
    return str(DB_CANDIDATES[0])


def get_db():
    conn = sqlite3.connect(_resolve_db_path())
    conn.row_factory = sqlite3.Row
    conn.create_function("normalize_text", 1, normalize_text)
    return conn
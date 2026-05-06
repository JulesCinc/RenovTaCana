import os
import sqlite3

from utils import normalize_text


BASE_DIR = os.path.dirname(__file__)
DB_PATH = os.path.join(BASE_DIR, "sqlite", "renovtacana.db")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.create_function("normalize_text", 1, normalize_text)
    return conn
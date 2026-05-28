from datetime import datetime
from pathlib import Path
import sqlite3
import re

from fastapi import APIRouter


router = APIRouter(prefix="/api", tags=["Database"])


def _project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _safe_count(conn: sqlite3.Connection, table_name: str) -> int:
    cur = conn.cursor()
    try:
        cur.execute(f"SELECT COUNT(*) FROM {table_name}")
        value = cur.fetchone()
        return int(value[0]) if value else 0
    except sqlite3.Error:
        return 0


def _archive_datetime_from_name(filename: str) -> datetime | None:
    match = re.search(r"(\d{8})_(\d{6})", filename)
    if not match:
        return None
    try:
        return datetime.strptime(f"{match.group(1)}{match.group(2)}", "%Y%m%d%H%M%S")
    except ValueError:
        return None


@router.get("/database/outdated")
def list_outdated_databases():
    project_root = _project_root()
    active_db = project_root / "database" / "renovTaCana.db"
    outdated_dir = _project_root() / "database" / "outdated"

    if not outdated_dir.exists():
        return {
            "items": [],
            "count": 0,
            "active_counts": {"canalisations": 0, "chantiers": 0, "operations": 0},
        }

    active_counts = {"canalisations": 0, "chantiers": 0, "operations": 0}
    if active_db.exists():
        try:
            active_conn = sqlite3.connect(active_db)
            active_counts["canalisations"] = _safe_count(active_conn, "canalisations")
            active_counts["chantiers"] = _safe_count(active_conn, "chantiers")
            active_counts["operations"] = _safe_count(active_conn, "operations")
            active_conn.close()
        except sqlite3.Error:
            pass

    items = []
    for db_file in outdated_dir.glob("*.db"):
        stat = db_file.stat()
        archive_dt = _archive_datetime_from_name(db_file.name)
        effective_dt = archive_dt or datetime.fromtimestamp(stat.st_mtime)
        canalisations = 0
        chantiers = 0
        operations = 0
        conn = None
        try:
            conn = sqlite3.connect(db_file.as_posix())
            canalisations = _safe_count(conn, "canalisations")
            chantiers = _safe_count(conn, "chantiers")
            operations = _safe_count(conn, "operations")
        except sqlite3.Error:
            pass
        finally:
            if conn is not None:
                conn.close()

        items.append(
            {
                "filename": db_file.name,
                "path": f"database/outdated/{db_file.name}",
                "size_bytes": stat.st_size,
                "archive_ts": effective_dt.timestamp(),
                "modified_ts": stat.st_mtime,
                "modified_at": effective_dt.isoformat(timespec="seconds"),
                "modified_at_display": effective_dt.strftime("%d/%m/%Y %H:%M"),
                "counts": {
                    "canalisations": canalisations,
                    "chantiers": chantiers,
                    "operations": operations,
                },
            }
        )

    items.sort(key=lambda x: x["archive_ts"], reverse=True)
    return {"items": items, "count": len(items), "active_counts": active_counts}

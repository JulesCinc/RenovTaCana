import shutil
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException

from database import get_db
from script.priority_score import priority_score_sql


router = APIRouter(prefix="/api", tags=["Database"])


def _project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _resolve_active_db_path() -> Path:
    project_root = _project_root()
    candidates = [
        project_root / "database" / "renovTaCana.db",
        project_root / "database" / "renovtacana.db",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def _archive_active_db_before_update() -> str | None:
    active_db = _resolve_active_db_path()
    if not active_db.exists():
        return None

    outdated_dir = active_db.parent / "outdated"
    outdated_dir.mkdir(parents=True, exist_ok=True)

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    archive_name = f"renovTaCana_{ts}.db"
    archive_path = outdated_dir / archive_name
    shutil.copy2(active_db, archive_path)
    return archive_name


@router.post("/database/compute-priority")
def compute_priority_scores():
    """Calcule et enregistre score_priorite pour toutes les canalisations."""
    score_expr = priority_score_sql()
    archive_name = None

    try:
        archive_name = _archive_active_db_before_update()
        conn = get_db()
        cur = conn.cursor()
        cur.execute(
            f"""
            UPDATE canalisations
            SET score_priorite = {score_expr}
            WHERE criticite IS NOT NULL
            """
        )
        updated = cur.rowcount
        cur.execute(
            "UPDATE canalisations SET score_priorite = NULL WHERE criticite IS NULL"
        )
        conn.commit()
        conn.close()
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Calcul du score de priorité impossible: {exc}",
        ) from exc

    return {
        "updated": updated,
        "archive": archive_name,
        "message": f"Score de priorité calculé pour {updated} canalisations.",
    }

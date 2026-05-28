from pathlib import Path
import shutil
from datetime import datetime
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel


router = APIRouter(prefix="/api", tags=["Database"])


def _project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _archive_timestamp(archive: Path) -> float:
    match = re.search(r"(\d{8})_(\d{6})", archive.name)
    if not match:
        return archive.stat().st_mtime
    try:
        dt = datetime.strptime(f"{match.group(1)}{match.group(2)}", "%Y%m%d%H%M%S")
        return dt.timestamp()
    except ValueError:
        return archive.stat().st_mtime


class RollbackRequest(BaseModel):
    filename: str


@router.post("/database/rollback")
def rollback_database(payload: RollbackRequest):
    project_root = _project_root()
    outdated_dir = project_root / "database" / "outdated"
    active_db = project_root / "database" / "renovTaCana.db"

    if not outdated_dir.exists():
        raise HTTPException(status_code=404, detail="Dossier d'archives introuvable.")

    archives = [p for p in outdated_dir.glob("*.db") if p.is_file()]
    if not archives:
        raise HTTPException(status_code=404, detail="Aucune archive disponible.")

    target = None
    for archive in archives:
        if archive.name == payload.filename:
            target = archive
            break

    if target is None:
        raise HTTPException(status_code=404, detail="Archive cible introuvable.")

    target_ts = _archive_timestamp(target)
    deleted_archives = []
    for archive in archives:
        if _archive_timestamp(archive) > target_ts:
            archive.unlink(missing_ok=True)
            deleted_archives.append(archive.name)

    # L'archive cible devient la base active.
    shutil.copy2(target, active_db)
    # Puis on retire aussi l'archive cible du dossier outdated.
    target.unlink(missing_ok=True)
    deleted_archives.append(target.name)

    return {
        "status": "ok",
        "active_database": str(active_db.relative_to(project_root)).replace("\\", "/"),
        "rollback_source": target.name,
        "deleted_archives": deleted_archives,
        "deleted_count": len(deleted_archives),
    }

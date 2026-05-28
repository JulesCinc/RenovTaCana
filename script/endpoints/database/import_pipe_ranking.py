import io
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import APIRouter, File, HTTPException, UploadFile

from database import get_db


router = APIRouter(prefix="/api", tags=["Database"])


def _normalize_header(value: str) -> str:
    text = str(value or "").strip().lower()
    text = re.sub(r"[^a-z0-9]+", "", text)
    return text


def _normalize_value(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if text.lower() == "nan":
        return ""
    return text


def _find_column(columns_map: dict[str, str], aliases: list[str]) -> str | None:
    for alias in aliases:
        if alias in columns_map:
            return columns_map[alias]
    return None


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


def _archive_active_db_before_import() -> str | None:
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


def _safe_float(value: str) -> float | None:
    if value == "":
        return None
    try:
        return float(value.replace(",", "."))
    except ValueError:
        return None


def _is_same_number(a: float | None, b: float | None, eps: float = 1e-9) -> bool:
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    return abs(a - b) <= eps


@router.post("/database/import/pipe-ranking")
async def import_pipe_ranking(file: UploadFile = File(...)):
    filename = file.filename or ""
    lower_name = filename.lower()
    if not lower_name.endswith((".xlsx", ".xls", ".csv")):
        raise HTTPException(status_code=400, detail="Le fichier doit etre un CSV ou Excel (.csv/.xlsx/.xls).")

    try:
        content = await file.read()
        if lower_name.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(content), sep=None, engine="python", encoding="utf-8-sig")
        else:
            df = pd.read_excel(io.BytesIO(content), sheet_name=0)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Lecture du fichier impossible: {exc}") from exc

    if df.empty:
        raise HTTPException(status_code=400, detail="Le fichier est vide.")

    normalized_to_original = {_normalize_header(col): col for col in df.columns}
    col_facilityid = _find_column(normalized_to_original, ["facilityid", "idcanalisation"])
    col_proba = _find_column(normalized_to_original, ["probabilitecasse", "probabilite", "proba"])
    col_longueur = _find_column(normalized_to_original, ["longueur", "length"])

    missing_required = []
    if not col_facilityid:
        missing_required.append("FACILITYID")
    if not col_proba:
        missing_required.append("probabilite_casse")
    if missing_required:
        raise HTTPException(status_code=400, detail=f"Colonnes obligatoires manquantes: {', '.join(missing_required)}")

    archive_name = None

    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT facilityid, criticite, score_priorite FROM canalisations")
    existing = {
        (row[0] or "").strip().lower(): {
            "criticite": float(row[1]) if row[1] is not None else None,
            "score_priorite": float(row[2]) if row[2] is not None else None,
        }
        for row in cur.fetchall()
    }

    seen_rows = set()
    updated = 0
    skipped_duplicates = 0
    skipped_empty = 0
    skipped_unknown_facilityid = 0

    for _, row in df.iterrows():
        facilityid = _normalize_value(row[col_facilityid]) if col_facilityid else ""
        proba_raw = _normalize_value(row[col_proba]) if col_proba else ""
        longueur_raw = _normalize_value(row[col_longueur]) if col_longueur else ""
        dedup_key = (facilityid.lower(), proba_raw.lower(), longueur_raw.lower())

        if not facilityid or not proba_raw:
            skipped_empty += 1
            continue

        if dedup_key in seen_rows:
            skipped_duplicates += 1
            continue
        seen_rows.add(dedup_key)

        if facilityid.lower() not in existing:
            skipped_unknown_facilityid += 1
            continue

        proba_value = _safe_float(proba_raw)
        if proba_value is None:
            skipped_empty += 1
            continue

        # Même logique que le build: probabilite_casse [0..1] -> criticite/score en %
        ranking_score = proba_value * 100.0 if 0.0 <= proba_value <= 1.0 else proba_value
        current = existing[facilityid.lower()]
        if _is_same_number(current["criticite"], ranking_score) and _is_same_number(current["score_priorite"], ranking_score):
            skipped_duplicates += 1
            continue

        cur.execute(
            """
            UPDATE canalisations
            SET criticite = ?, score_priorite = ?
            WHERE LOWER(facilityid) = LOWER(?)
            """,
            (ranking_score, ranking_score, facilityid),
        )
        if cur.rowcount > 0:
            updated += 1
            current["criticite"] = ranking_score
            current["score_priorite"] = ranking_score

    if updated > 0:
        archive_name = _archive_active_db_before_import()
    conn.commit()
    conn.close()

    return {
        "status": "ok",
        "filename": filename,
        "backup_archive": archive_name,
        "inserted": updated,
        "skipped_duplicates": skipped_duplicates,
        "skipped_empty": skipped_empty,
        "skipped_unknown_facilityid": skipped_unknown_facilityid,
        "total_rows": int(len(df)),
    }

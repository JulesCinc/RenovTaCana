import re
import shutil
import io
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


@router.post("/database/import/operations")
async def import_operations_excel(file: UploadFile = File(...)):
    filename = file.filename or ""
    lower_name = filename.lower()
    if not lower_name.endswith((".xlsx", ".xls", ".csv")):
        raise HTTPException(status_code=400, detail="Le fichier doit etre un Excel ou CSV (.xlsx/.xls/.csv).")

    try:
        content = await file.read()
        if lower_name.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(content), sep=None, engine="python")
        else:
            df = pd.read_excel(io.BytesIO(content), sheet_name=0)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Lecture du fichier impossible: {exc}") from exc

    if df.empty:
        raise HTTPException(status_code=400, detail="Le fichier est vide.")

    normalized_to_original = {_normalize_header(col): col for col in df.columns}

    col_id_projet = _find_column(normalized_to_original, ["idprojet", "id"])
    col_id1 = _find_column(normalized_to_original, ["id1"])
    col_projet_titre = _find_column(normalized_to_original, ["projettitre", "projettitre"])
    col_titre = _find_column(normalized_to_original, ["titre", "projettitre"])
    col_commune = _find_column(normalized_to_original, ["idcommune", "commune", "ville"])
    col_localisation = _find_column(normalized_to_original, ["localisation", "adresse"])
    col_type_op = _find_column(normalized_to_original, ["operationtype1", "typeoperation", "typeop"])
    col_demandeur = _find_column(normalized_to_original, ["demandeur1", "demandeur"])
    col_annee = _find_column(normalized_to_original, ["operationannee", "oprationannee", "annee"])
    col_cpi = _find_column(normalized_to_original, ["cpi"])

    missing_required = []
    if not col_titre:
        missing_required.append("titre")
    if not col_commune:
        missing_required.append("commune")
    if missing_required:
        raise HTTPException(
            status_code=400,
            detail=f"Colonnes obligatoires manquantes: {', '.join(missing_required)}",
        )

    archive_name = None

    conn = get_db()
    cur = conn.cursor()
    cur.execute("PRAGMA table_info(operations)")
    existing_columns = {row[1] for row in cur.fetchall()}
    if "id1_source" not in existing_columns:
        cur.execute("ALTER TABLE operations ADD COLUMN id1_source TEXT")
    if "projet_titre" not in existing_columns:
        cur.execute("ALTER TABLE operations ADD COLUMN projet_titre TEXT")
    conn.commit()

    cur.execute(
        """
        SELECT
            COALESCE(TRIM(id1_source), ''),
            COALESCE(TRIM(id_projet), ''),
            COALESCE(TRIM(projet_titre), ''),
            COALESCE(TRIM(titre), ''),
            COALESCE(TRIM(commune), ''),
            COALESCE(TRIM(localisation), ''),
            COALESCE(TRIM(type_op), ''),
            COALESCE(TRIM(demandeur), ''),
            COALESCE(TRIM(annee), ''),
            COALESCE(TRIM(cpi), '')
        FROM operations
        """
    )
    existing_keys = {tuple((v or "").strip().lower() for v in row) for row in cur.fetchall()}

    rows_to_insert = []
    seen_keys_in_file = set()
    skipped_duplicates = 0
    skipped_empty = 0

    for _, row in df.iterrows():
        id1_source = _normalize_value(row[col_id1]) if col_id1 else ""
        id_projet_raw = _normalize_value(row[col_id_projet]) if col_id_projet else ""
        projet_titre = _normalize_value(row[col_projet_titre]) if col_projet_titre else ""
        titre = _normalize_value(row[col_titre]) if col_titre else ""
        commune = _normalize_value(row[col_commune]) if col_commune else ""
        localisation = _normalize_value(row[col_localisation]) if col_localisation else ""
        type_op = _normalize_value(row[col_type_op]) if col_type_op else ""
        demandeur = _normalize_value(row[col_demandeur]) if col_demandeur else ""
        annee = _normalize_value(row[col_annee]) if col_annee else ""
        cpi = _normalize_value(row[col_cpi]) if col_cpi else ""

        id_projet = None
        if id_projet_raw:
            try:
                id_projet = int(float(id_projet_raw))
            except ValueError:
                id_projet = None

        row_key = (
            id1_source.lower(),
            str(id_projet or "").lower(),
            projet_titre.lower(),
            titre.lower(),
            commune.lower(),
            localisation.lower(),
            type_op.lower(),
            demandeur.lower(),
            annee.lower(),
            cpi.lower(),
        )

        if not any(row_key):
            skipped_empty += 1
            continue

        if row_key in existing_keys or row_key in seen_keys_in_file:
            skipped_duplicates += 1
            continue

        seen_keys_in_file.add(row_key)
        rows_to_insert.append((id1_source, id_projet, projet_titre, titre, commune, localisation, type_op, demandeur, annee, cpi))

    inserted = 0
    if rows_to_insert:
        archive_name = _archive_active_db_before_import()
        cur.executemany(
            """
            INSERT INTO operations (id1_source, id_projet, projet_titre, titre, commune, localisation, type_op, demandeur, annee, cpi)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows_to_insert,
        )
        inserted = len(rows_to_insert)
        conn.commit()

    conn.close()

    return {
        "status": "ok",
        "filename": filename,
        "backup_archive": archive_name,
        "inserted": inserted,
        "skipped_duplicates": skipped_duplicates,
        "skipped_empty": skipped_empty,
        "total_rows": int(len(df)),
    }

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


@router.post("/database/import/chantiers")
async def import_chantiers_excel(file: UploadFile = File(...)):
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

    col_num_op = _find_column(
        normalized_to_original,
        [
            "nchantieroperation",
            "nchantieropration",
            "numop",
            "noperation",
            "numerooperation",
        ],
    )
    col_etat = _find_column(normalized_to_original, ["etat", "tat", "status"])
    col_date_debut = _find_column(normalized_to_original, ["debut", "dbut", "datedebut", "startdate"])
    col_date_fin = _find_column(normalized_to_original, ["fin", "datefin", "enddate"])
    col_commune = _find_column(normalized_to_original, ["commune", "ville"])
    col_libelle = _find_column(normalized_to_original, ["libelle", "objet", "description"])
    col_page = _find_column(normalized_to_original, ["page"])
    col_adresse = _find_column(normalized_to_original, ["adresse", "address"])

    missing_required = []
    if not col_num_op:
        missing_required.append("num_op (ex: nChantierOperation)")
    if not col_commune:
        missing_required.append("commune")
    if not col_libelle:
        missing_required.append("libelle")
    if missing_required:
        raise HTTPException(
            status_code=400,
            detail=f"Colonnes obligatoires manquantes: {', '.join(missing_required)}",
        )

    archive_name = None

    conn = get_db()
    cur = conn.cursor()

    cur.execute(
        """
        SELECT
            COALESCE(TRIM(num_op), ''),
            COALESCE(TRIM(etat), ''),
            COALESCE(TRIM(date_debut), ''),
            COALESCE(TRIM(date_fin), ''),
            COALESCE(TRIM(commune), ''),
            COALESCE(TRIM(libelle), ''),
            COALESCE(TRIM(adresse), ''),
            COALESCE(TRIM(CAST(page AS TEXT)), '')
        FROM chantiers
        """
    )
    existing_keys = {tuple((v or "").strip().lower() for v in row) for row in cur.fetchall()}

    cur.execute("PRAGMA table_info(chantiers)")
    table_columns = {row[1] for row in cur.fetchall()}

    rows_to_insert: list[tuple[Any, ...]] = []
    seen_keys_in_file = set()
    skipped_duplicates = 0
    skipped_empty = 0

    for _, row in df.iterrows():
        num_op = _normalize_value(row[col_num_op]) if col_num_op else ""
        etat = _normalize_value(row[col_etat]) if col_etat else ""
        date_debut = _normalize_value(row[col_date_debut]) if col_date_debut else ""
        date_fin = _normalize_value(row[col_date_fin]) if col_date_fin else ""
        commune = _normalize_value(row[col_commune]) if col_commune else ""
        libelle = _normalize_value(row[col_libelle]) if col_libelle else ""
        adresse = _normalize_value(row[col_adresse]) if col_adresse else ""

        page = None
        if col_page:
            page_text = _normalize_value(row[col_page])
            if page_text:
                try:
                    page = int(float(page_text))
                except ValueError:
                    page = None

        row_key = (
            num_op.lower(),
            etat.lower(),
            date_debut.lower(),
            date_fin.lower(),
            commune.lower(),
            libelle.lower(),
            adresse.lower(),
            str(page or "").lower(),
        )

        # Ignore les lignes vraiment vides.
        if not any(row_key):
            skipped_empty += 1
            continue

        if row_key in existing_keys or row_key in seen_keys_in_file:
            skipped_duplicates += 1
            continue

        seen_keys_in_file.add(row_key)

        insert_values = [num_op, etat, date_debut, date_fin, commune, libelle]
        insert_columns = ["num_op", "etat", "date_debut", "date_fin", "commune", "libelle"]

        if "adresse" in table_columns:
            insert_columns.append("adresse")
            insert_values.append(adresse or None)
        if "page" in table_columns:
            insert_columns.append("page")
            insert_values.append(page)

        placeholders = ", ".join(["?" for _ in insert_columns])
        sql = f"INSERT INTO chantiers ({', '.join(insert_columns)}) VALUES ({placeholders})"
        rows_to_insert.append((sql, tuple(insert_values)))

    inserted = 0
    if rows_to_insert:
        archive_name = _archive_active_db_before_import()
        for sql, values in rows_to_insert:
            cur.execute(sql, values)
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

"""
Convert segmentation geometries from EPSG:2154 to EPSG:4326.

The Leaflet map consumes GeoJSON coordinates as [longitude, latitude], which
means WGS84 / EPSG:4326. This script keeps the original Lambert-93 geometry
untouched and writes the converted WKT into a dedicated SQLite column.
"""
from __future__ import annotations

import argparse
import os
import sqlite3
from pathlib import Path
from typing import Any


DEFAULT_TABLE = "segmentation"
DEFAULT_ID_COLUMN = "id"
DEFAULT_SOURCE_COLUMN = "geometry"
DEFAULT_OUTPUT_COLUMN = "geometry_4326"
DEFAULT_SOURCE_CRS = "EPSG:2154"
DEFAULT_TARGET_CRS = "EPSG:4326"
DEFAULT_BATCH_SIZE = 1000
DEFAULT_ROUNDING_PRECISION = 8


def _project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _default_sqlite_path() -> Path:
    return _project_root() / "database" / "renovTaCana.db"


def _quote_identifier(identifier: str) -> str:
    return '"' + str(identifier).replace('"', '""') + '"'


def _table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def _table_columns(conn: sqlite3.Connection, table_name: str) -> set[str]:
    if not _table_exists(conn, table_name):
        return set()
    rows = conn.execute(f"PRAGMA table_info({_quote_identifier(table_name)})").fetchall()
    return {row[1] for row in rows}


def _require_geo_libs() -> dict[str, Any]:
    try:
        from pyproj import Transformer
        from shapely import wkt
        from shapely.ops import transform
    except ImportError as exc:
        raise RuntimeError(
            "Geometry conversion requires pyproj and shapely. "
            "Install the dependencies from requirements.txt."
        ) from exc

    return {
        "Transformer": Transformer,
        "transform": transform,
        "wkt": wkt,
    }


def _ensure_output_column(
    conn: sqlite3.Connection,
    table_name: str,
    id_column: str,
    source_column: str,
    output_column: str,
) -> None:
    columns = _table_columns(conn, table_name)
    if not columns:
        raise RuntimeError(f"Table not found: {table_name}")
    for column in (id_column, source_column):
        if column not in columns:
            raise RuntimeError(f"Column not found in {table_name}: {column}")
    if output_column not in columns:
        conn.execute(
            f"""
            ALTER TABLE {_quote_identifier(table_name)}
            ADD COLUMN {_quote_identifier(output_column)} TEXT
            """
        )


def _convert_wkt_geometry(
    geometry_wkt: str,
    transformer: Any,
    shapely_wkt: Any,
    shapely_transform: Any,
    rounding_precision: int,
) -> str:
    geometry = shapely_wkt.loads(geometry_wkt)
    converted = shapely_transform(transformer.transform, geometry)
    return shapely_wkt.dumps(
        converted,
        rounding_precision=rounding_precision,
        trim=True,
        output_dimension=2,
    )


def convert_table_geometries(
    sqlite_path: str | os.PathLike[str],
    table_name: str = DEFAULT_TABLE,
    id_column: str = DEFAULT_ID_COLUMN,
    source_column: str = DEFAULT_SOURCE_COLUMN,
    output_column: str = DEFAULT_OUTPUT_COLUMN,
    source_crs: str = DEFAULT_SOURCE_CRS,
    target_crs: str = DEFAULT_TARGET_CRS,
    force_recompute: bool = False,
    dry_run: bool = False,
    limit: int | None = None,
    batch_size: int = DEFAULT_BATCH_SIZE,
    rounding_precision: int = DEFAULT_ROUNDING_PRECISION,
) -> dict[str, Any]:
    if batch_size <= 0:
        raise ValueError("batch_size must be positive")
    if rounding_precision < 0:
        raise ValueError("rounding_precision must be zero or positive")

    libs = _require_geo_libs()
    transformer = libs["Transformer"].from_crs(
        source_crs,
        target_crs,
        always_xy=True,
    )
    shapely_wkt = libs["wkt"]
    shapely_transform = libs["transform"]

    sqlite_path = str(sqlite_path)
    converted_count = 0
    error_count = 0
    sample_before = None
    sample_after = None
    errors: list[dict[str, Any]] = []

    with sqlite3.connect(sqlite_path) as conn:
        if dry_run:
            columns = _table_columns(conn, table_name)
            if not columns:
                raise RuntimeError(f"Table not found: {table_name}")
            for column in (id_column, source_column):
                if column not in columns:
                    raise RuntimeError(f"Column not found in {table_name}: {column}")
        else:
            _ensure_output_column(conn, table_name, id_column, source_column, output_column)
            conn.commit()

        table_sql = _quote_identifier(table_name)
        id_sql = _quote_identifier(id_column)
        source_sql = _quote_identifier(source_column)
        output_sql = _quote_identifier(output_column)

        filters = [
            f"{source_sql} IS NOT NULL",
            f"TRIM({source_sql}) != ''",
        ]
        if not force_recompute and not dry_run:
            filters.append(f"({output_sql} IS NULL OR TRIM({output_sql}) = '')")

        query = f"""
            SELECT {id_sql} AS row_id, {source_sql} AS source_geometry
            FROM {table_sql}
            WHERE {" AND ".join(filters)}
            ORDER BY {id_sql}
        """
        params: tuple[Any, ...] = ()
        if limit is not None:
            query += " LIMIT ?"
            params = (int(limit),)

        rows = conn.execute(query, params)
        updates: list[tuple[str, Any]] = []

        for row_id, source_geometry in rows:
            try:
                converted_geometry = _convert_wkt_geometry(
                    source_geometry,
                    transformer,
                    shapely_wkt,
                    shapely_transform,
                    rounding_precision,
                )
            except Exception as exc:  # Keep processing the rest of the table.
                error_count += 1
                if len(errors) < 5:
                    errors.append({"id": row_id, "error": str(exc)})
                continue

            if sample_before is None:
                sample_before = source_geometry
                sample_after = converted_geometry

            converted_count += 1
            if not dry_run:
                updates.append((converted_geometry, row_id))
                if len(updates) >= batch_size:
                    conn.executemany(
                        f"UPDATE {table_sql} SET {output_sql} = ? WHERE {id_sql} = ?",
                        updates,
                    )
                    updates.clear()

        if updates and not dry_run:
            conn.executemany(
                f"UPDATE {table_sql} SET {output_sql} = ? WHERE {id_sql} = ?",
                updates,
            )

        if dry_run:
            total_with_output = None
            conn.rollback()
        else:
            total_with_output = conn.execute(
                f"""
                SELECT COUNT(*)
                FROM {table_sql}
                WHERE {output_sql} IS NOT NULL
                  AND TRIM({output_sql}) != ''
                """
            ).fetchone()[0]
            conn.commit()

    return {
        "ok": error_count == 0,
        "sqlite_path": sqlite_path,
        "table": table_name,
        "source_column": source_column,
        "output_column": output_column,
        "source_crs": source_crs,
        "target_crs": target_crs,
        "dry_run": dry_run,
        "force_recompute": force_recompute,
        "converted": converted_count,
        "errors": error_count,
        "error_samples": errors,
        "total_with_output": total_with_output,
        "sample_before": sample_before,
        "sample_after": sample_after,
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert SQLite WKT geometries from EPSG:2154 to EPSG:4326."
    )
    parser.add_argument("--sqlite-path", "--db", default=str(_default_sqlite_path()))
    parser.add_argument("--table", default=DEFAULT_TABLE)
    parser.add_argument("--id-column", default=DEFAULT_ID_COLUMN)
    parser.add_argument("--source-column", default=DEFAULT_SOURCE_COLUMN)
    parser.add_argument("--output-column", default=DEFAULT_OUTPUT_COLUMN)
    parser.add_argument("--source-crs", default=DEFAULT_SOURCE_CRS)
    parser.add_argument("--target-crs", default=DEFAULT_TARGET_CRS)
    parser.add_argument("--force-recompute", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--rounding-precision", type=int, default=DEFAULT_ROUNDING_PRECISION)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    summary = convert_table_geometries(
        sqlite_path=args.sqlite_path,
        table_name=args.table,
        id_column=args.id_column,
        source_column=args.source_column,
        output_column=args.output_column,
        source_crs=args.source_crs,
        target_crs=args.target_crs,
        force_recompute=args.force_recompute,
        dry_run=args.dry_run,
        limit=args.limit,
        batch_size=args.batch_size,
        rounding_precision=args.rounding_precision,
    )
    print(summary)
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
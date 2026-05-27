"""
Segment existing pipe geometries into sections of 250 meters maximum.

This script has one responsibility: read pipe geometries, cut long pipes
spatially, and store the resulting segments in a SQLite table named
`segmentation` by default.
"""
from __future__ import annotations

import argparse
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional


DEFAULT_SOURCE_TABLE = "canalisations"
DEFAULT_OUTPUT_TABLE = "segmentation"
DEFAULT_MAX_SEGMENT_LENGTH = 250.0
DEFAULT_SOURCE_CRS = "EPSG:2154"
DEFAULT_METRIC_CRS = "EPSG:2154"


def _project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _default_sqlite_path() -> Path:
    return _project_root() / "database" / "renovTaCana.db"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


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


def _first_existing(columns: Iterable[str], candidates: Iterable[str]) -> Optional[str]:
    lower_to_real = {col.lower(): col for col in columns}
    for candidate in candidates:
        found = lower_to_real.get(candidate.lower())
        if found:
            return found
    return None


def _require_geo_libs():
    try:
        import geopandas as gpd
        import pandas as pd
        from shapely import wkt
        from shapely.geometry import LineString, MultiLineString
        from shapely.ops import substring
    except ImportError as exc:
        raise RuntimeError(
            "Pipe segmentation requires geopandas, pandas and shapely. "
            "Install the dependencies from requirements.txt."
        ) from exc

    return {
        "gpd": gpd,
        "pd": pd,
        "wkt": wkt,
        "LineString": LineString,
        "MultiLineString": MultiLineString,
        "substring": substring,
    }


def _empty_geodataframe(df, gpd, crs: str):
    if "geometry" not in df.columns:
        df = df.assign(geometry=None)
    return gpd.GeoDataFrame(df.iloc[0:0].copy(), geometry="geometry", crs=crs)


def _ensure_segmentation_table(conn: sqlite3.Connection, output_table: str) -> None:
    table_sql = _quote_identifier(output_table)
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {table_sql} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pipe_id_original TEXT NOT NULL,
            segment_index INTEGER NOT NULL,
            segment_length REAL NOT NULL,
            geometry TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(pipe_id_original, segment_index)
        )
        """
    )
    conn.execute(
        f"""
        CREATE INDEX IF NOT EXISTS {_quote_identifier(f"idx_{output_table}_pipe")}
        ON {table_sql}(pipe_id_original)
        """
    )


def _clear_segmentation_table(conn: sqlite3.Connection, output_table: str) -> None:
    conn.execute(f"DELETE FROM {_quote_identifier(output_table)}")
    if _table_exists(conn, "sqlite_sequence"):
        conn.execute("DELETE FROM sqlite_sequence WHERE name = ?", (output_table,))


def _existing_pipe_ids(conn: sqlite3.Connection, output_table: str) -> set[str]:
    if not _table_exists(conn, output_table):
        return set()
    if "pipe_id_original" not in _table_columns(conn, output_table):
        return set()
    rows = conn.execute(
        f"SELECT DISTINCT pipe_id_original FROM {_quote_identifier(output_table)}"
    ).fetchall()
    return {str(row[0]) for row in rows if row[0] is not None}


def _read_pipes_from_sqlite(
    sqlite_path: str | os.PathLike[str],
    source_table: str,
    source_crs: str,
    metric_crs: str,
    skip_pipe_ids: set[str],
    limit: Optional[int] = None,
):
    libs = _require_geo_libs()
    gpd = libs["gpd"]
    pd = libs["pd"]
    wkt = libs["wkt"]

    with sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True) as conn:
        if not _table_exists(conn, source_table):
            raise RuntimeError(f"Source table not found: {source_table}")

        columns = _table_columns(conn, source_table)
        geometry_col = _first_existing(columns, ("geometry", "geom", "wkt", "the_geom"))
        id_col = _first_existing(
            columns,
            ("pipe_id_original", "facilityid", "FACILITYID", "id", "OBJECTID"),
        )

        if geometry_col:
            pipe_id_sql = (
                f"{_quote_identifier(id_col)} AS pipe_id_original"
                if id_col
                else "rowid AS pipe_id_original"
            )
            query = f"""
                SELECT {pipe_id_sql}, {_quote_identifier(geometry_col)} AS geometry_wkt
                FROM {_quote_identifier(source_table)}
                WHERE {_quote_identifier(geometry_col)} IS NOT NULL
                  AND TRIM({_quote_identifier(geometry_col)}) != ''
            """
        elif source_table.lower() == "canalisations" and _table_exists(conn, "conduites"):
            query = """
                SELECT
                    COALESCE(can.facilityid, c.FACILITYID) AS pipe_id_original,
                    c.geometry AS geometry_wkt
                FROM canalisations can
                JOIN conduites c ON c.FACILITYID = can.facilityid
                WHERE c.geometry IS NOT NULL
                  AND TRIM(c.geometry) != ''
            """
        else:
            raise RuntimeError(
                f"Source table {source_table} has no geometry column. "
                "Use source_table='conduites' or provide shapefile_path."
            )

        if limit is not None:
            query += f" LIMIT {int(limit)}"

        df = pd.read_sql_query(query, conn)

    if df.empty:
        return _empty_geodataframe(df, gpd, metric_crs)

    if skip_pipe_ids:
        df = df[~df["pipe_id_original"].astype(str).isin(skip_pipe_ids)].copy()
    if df.empty:
        return _empty_geodataframe(df, gpd, metric_crs)

    df["geometry"] = df["geometry_wkt"].apply(lambda value: wkt.loads(value) if value else None)
    df = df[df["geometry"].notna()].drop(columns=["geometry_wkt"])
    gdf = gpd.GeoDataFrame(df, geometry="geometry", crs=source_crs)
    if str(gdf.crs) != str(metric_crs):
        gdf = gdf.to_crs(metric_crs)
    return gdf


def _read_pipes_from_shapefile(
    shapefile_path: str | os.PathLike[str],
    source_crs: str,
    metric_crs: str,
    skip_pipe_ids: set[str],
    limit: Optional[int] = None,
):
    libs = _require_geo_libs()
    gpd = libs["gpd"]

    gdf = gpd.read_file(shapefile_path)
    if limit is not None:
        gdf = gdf.head(int(limit)).copy()

    if gdf.crs is None:
        gdf = gdf.set_crs(source_crs)
    id_col = _first_existing(gdf.columns, ("pipe_id_original", "FACILITYID", "facilityid", "id", "OBJECTID"))
    if id_col:
        gdf["pipe_id_original"] = gdf[id_col].astype(str)
    else:
        gdf["pipe_id_original"] = [f"pipe_{idx}" for idx in range(len(gdf))]

    if skip_pipe_ids:
        gdf = gdf[~gdf["pipe_id_original"].astype(str).isin(skip_pipe_ids)].copy()
    if str(gdf.crs) != str(metric_crs):
        gdf = gdf.to_crs(metric_crs)
    return gdf[["pipe_id_original", "geometry"]]


def _line_parts(geometry, line_type, multiline_type) -> list[Any]:
    if geometry is None or geometry.is_empty:
        return []
    if isinstance(geometry, line_type):
        return [geometry]
    if isinstance(geometry, multiline_type):
        return list(geometry.geoms)
    return []


def _split_line(line, max_segment_length: float, min_segment_length: float = 0.001) -> list[Any]:
    libs = _require_geo_libs()
    substring = libs["substring"]

    line_length = float(line.length or 0.0)
    if line_length <= 0:
        return []
    if line_length <= max_segment_length + 1e-9:
        return [line]

    pieces = []
    start = 0.0
    while start < line_length:
        end = min(start + max_segment_length, line_length)
        if end - start >= min_segment_length:
            piece = substring(line, start, end, normalized=False)
            if not piece.is_empty:
                pieces.append(piece)
        start = end
    return pieces


def _split_geometry(geometry, max_segment_length: float) -> list[Any]:
    libs = _require_geo_libs()
    line_type = libs["LineString"]
    multiline_type = libs["MultiLineString"]

    total_length = float(geometry.length or 0.0) if geometry is not None else 0.0
    if total_length <= 0:
        return []
    if total_length <= max_segment_length + 1e-9:
        return [geometry]

    pieces = []
    for part in _line_parts(geometry, line_type, multiline_type):
        pieces.extend(_split_line(part, max_segment_length))
    return pieces


def _segment_rows(gdf, max_segment_length: float, created_at: str) -> list[tuple[Any, ...]]:
    rows = []
    for _, pipe in gdf.iterrows():
        pipe_id = str(pipe["pipe_id_original"])
        pieces = _split_geometry(pipe.geometry, max_segment_length)
        for segment_index, piece in enumerate(pieces, start=1):
            rows.append(
                (
                    pipe_id,
                    segment_index,
                    round(float(piece.length), 3),
                    piece.wkt,
                    created_at,
                )
            )
    return rows


def segment_pipes_to_sqlite(
    sqlite_path: str,
    source_table: str = DEFAULT_SOURCE_TABLE,
    output_table: str = DEFAULT_OUTPUT_TABLE,
    max_segment_length: float = DEFAULT_MAX_SEGMENT_LENGTH,
    force_recompute: bool = False,
    shapefile_path: str | None = None,
    source_crs: str = DEFAULT_SOURCE_CRS,
    metric_crs: str = DEFAULT_METRIC_CRS,
    limit: Optional[int] = None,
) -> dict[str, Any]:
    """
    Segment existing pipe geometries into sections of `max_segment_length`
    meters maximum and save the result in a SQLite table.

    If `force_recompute` is False, pipes already present in the output table
    are skipped to avoid duplicate segments. If True, the output table is
    cleared and all segments are recomputed.
    """
    if max_segment_length <= 0:
        raise ValueError("max_segment_length must be positive")

    sqlite_path = str(sqlite_path)
    created_at = _utc_now_iso()

    with sqlite3.connect(sqlite_path) as conn:
        _ensure_segmentation_table(conn, output_table)
        if force_recompute:
            _clear_segmentation_table(conn, output_table)
        skip_pipe_ids = set() if force_recompute else _existing_pipe_ids(conn, output_table)
        conn.commit()

    if shapefile_path:
        pipes_gdf = _read_pipes_from_shapefile(
            shapefile_path,
            source_crs=source_crs,
            metric_crs=metric_crs,
            skip_pipe_ids=skip_pipe_ids,
            limit=limit,
        )
    else:
        pipes_gdf = _read_pipes_from_sqlite(
            sqlite_path,
            source_table=source_table,
            source_crs=source_crs,
            metric_crs=metric_crs,
            skip_pipe_ids=skip_pipe_ids,
            limit=limit,
        )

    rows = _segment_rows(pipes_gdf, max_segment_length, created_at)

    with sqlite3.connect(sqlite_path) as conn:
        _ensure_segmentation_table(conn, output_table)
        conn.executemany(
            f"""
            INSERT OR IGNORE INTO {_quote_identifier(output_table)} (
                pipe_id_original,
                segment_index,
                segment_length,
                geometry,
                created_at
            )
            VALUES (?, ?, ?, ?, ?)
            """,
            rows,
        )
        inserted_segments = conn.total_changes
        total_segments = conn.execute(
            f"SELECT COUNT(*) FROM {_quote_identifier(output_table)}"
        ).fetchone()[0]
        conn.commit()

    return {
        "ok": True,
        "source_table": source_table,
        "output_table": output_table,
        "pipes_read": int(len(pipes_gdf)),
        "pipes_skipped": int(len(skip_pipe_ids)),
        "segments_generated": int(len(rows)),
        "segments_inserted": int(inserted_segments),
        "total_segments": int(total_segments),
        "force_recompute": bool(force_recompute),
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Segment pipe geometries into SQLite table `segmentation`."
    )
    parser.add_argument("--sqlite-path", "--db", default=str(_default_sqlite_path()))
    parser.add_argument("--source-table", default=DEFAULT_SOURCE_TABLE)
    parser.add_argument("--output-table", default=DEFAULT_OUTPUT_TABLE)
    parser.add_argument("--max-segment-length", type=float, default=DEFAULT_MAX_SEGMENT_LENGTH)
    parser.add_argument("--force-recompute", action="store_true")
    parser.add_argument("--shapefile-path", "--shapefile", default=None)
    parser.add_argument("--source-crs", default=DEFAULT_SOURCE_CRS)
    parser.add_argument("--metric-crs", default=DEFAULT_METRIC_CRS)
    parser.add_argument("--limit", type=int, default=None)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    summary = segment_pipes_to_sqlite(
        sqlite_path=args.sqlite_path,
        source_table=args.source_table,
        output_table=args.output_table,
        max_segment_length=args.max_segment_length,
        force_recompute=args.force_recompute,
        shapefile_path=args.shapefile_path,
        source_crs=args.source_crs,
        metric_crs=args.metric_crs,
        limit=args.limit,
    )
    print(summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

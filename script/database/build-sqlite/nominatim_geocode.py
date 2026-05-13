"""
Géocodage chantiers (Nominatim) — logique partagée build SQLite + fallback API.

Utilisé au build pour remplir chantiers.adresse (extraction depuis libelle),
puis chantiers.latitude / longitude **uniquement à partir de la colonne adresse**.
"""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple


def _tqdm(iterable, **kwargs):
    """Barre tqdm si disponible et TTY ; sinon iteration simple."""
    kwargs.setdefault("disable", not sys.stdout.isatty())
    try:
        from tqdm import tqdm as _tq

        return _tq(iterable, **kwargs)
    except ImportError:
        return iterable


# Bounding box Nice et proche périphérie (aligné sur l’ancien geojson.py)
LAT_MIN, LAT_MAX = 43.62, 44.35
LON_MIN, LON_MAX = 6.80, 7.42

_STREET_RE = re.compile(
    r"\b(rue|avenue|boulevard|allée|allee|chemin|impasse|place|voie|route|"
    r"passage|square|domaine|résidence|residence|montée|montee|traverse|quai|"
    r"promenade|corniche|esplanade|lotissement|sentier|draille)\b"
    r"[\s\-]+"
    r"([A-Za-zÀ-ÿ\'\-][A-Za-zÀ-ÿ\s\'\-\.0-9]{2,60})",
    re.IGNORECASE | re.UNICODE,
)

_TRAILING_NOISE = re.compile(
    r"\s+(?:phase|tranche|lot|section|suite|nord|sud|est|ouest|n°?\s*\d+|\d+)\s*$",
    re.IGNORECASE,
)


def in_bbox(lat: float, lon: float) -> bool:
    return LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX


def extract_street_from_libelle(libelle: str) -> Optional[str]:
    """Extrait un nom de voie depuis un libellé de chantier."""
    if not libelle:
        return None
    m = _STREET_RE.search(libelle)
    if not m:
        return None
    stype = m.group(1).strip()
    sname = m.group(2).strip()
    for sep in (" - ", " / ", " (", ";", " : ",
                " mise ", " pour ", " afin ", " ecl ", " proprié",
                " renouvellement", " rénovation", " réfection", " réparation",
                " création", " pose ", " travaux"):
        idx = sname.lower().find(sep.lower())
        if idx != -1:
            sname = sname[:idx].strip()
    sname = _TRAILING_NOISE.sub("", sname).strip().rstrip(".,;:/- ")
    if len(sname) < 2:
        return None
    if len(sname) > 50:
        sname = sname[:50].rsplit(" ", 1)[0]
    return f"{stype} {sname}"


def cache_payload_for_disk(cache: Dict[str, Any]) -> Dict[str, Any]:
    """
    Fichier geocode_cache.json : uniquement des paires
    \"voie, commune, france\" -> [latitude, longitude] (deux flottants).
    Exclut null, formats invalides et cles hors convention.
    """
    out: Dict[str, Any] = {}
    for k, v in cache.items():
        if not isinstance(k, str) or not k.endswith(", france"):
            continue
        if not isinstance(v, (list, tuple)) or len(v) < 2:
            continue
        try:
            lat, lon = float(v[0]), float(v[1])
        except (TypeError, ValueError):
            continue
        out[k] = [lat, lon]
    return out


def load_disk_cache(cache_path: str) -> Dict[str, Any]:
    try:
        if os.path.exists(cache_path):
            with open(cache_path, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as e:
        print(
            f"[build] AVERTISSEMENT lecture cache geocode ({cache_path}): {e}",
            file=sys.stderr,
            flush=True,
        )
    return {}


def save_disk_cache(cache_path: str, cache: Dict[str, Any]) -> None:
    """
    Ecriture atomique : evite un JSON tronque si le process s'arrete pendant l'ecriture.
    """
    dirname = os.path.dirname(os.path.abspath(cache_path)) or "."
    try:
        os.makedirs(dirname, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(
            prefix="geocode_cache_",
            suffix=".tmp.json",
            dir=dirname,
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                payload = cache_payload_for_disk(cache)
                json.dump(
                    payload,
                    f,
                    ensure_ascii=False,
                    indent=2,
                    allow_nan=False,
                    sort_keys=True,
                )
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp_path, cache_path)
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise
    except Exception as e:
        print(
            f"[build] AVERTISSEMENT ecriture cache geocode ({cache_path}): {e}",
            file=sys.stderr,
            flush=True,
        )


def clean_stale_cache_entries(cache: Dict[str, Any]) -> Dict[str, Any]:
    """Ne garde que les entrées persistables (meme filtre qu'a l'ecriture disque)."""
    return cache_payload_for_disk(cache)


_last_req_time = 0.0


def nominatim_request(params: dict) -> Optional[List[float]]:
    """Exécute une requête Nominatim (rate-limitée) et retourne [lat, lon] ou None."""
    global _last_req_time
    elapsed = time.time() - _last_req_time
    if elapsed < 1.15:
        time.sleep(1.15 - elapsed)
    req = urllib.request.Request(
        f"https://nominatim.openstreetmap.org/search?{urllib.parse.urlencode(params)}",
        headers={"User-Agent": "RenovTaCana/2.1 (+epf-academic-project)"},
    )
    _last_req_time = time.time()
    try:
        with urllib.request.urlopen(req, timeout=7) as resp:
            results = json.loads(resp.read().decode())
    except Exception:
        return None
    if not results:
        return None
    lat, lon = float(results[0]["lat"]), float(results[0]["lon"])
    if in_bbox(lat, lon):
        return [lat, lon]
    return None


def geocode_full_query(query: str) -> Optional[List[float]]:
    """
    query attendu : "{voie}, {commune}, France"
    Deux tentatives : q= + viewbox, puis street= + city=.
    """
    result = nominatim_request(
        {
            "q": query,
            "format": "json",
            "limit": 1,
            "countrycodes": "fr",
            "viewbox": f"{LON_MIN},{LAT_MAX},{LON_MAX},{LAT_MIN}",
            "bounded": 1,
        }
    )
    if result is None:
        parts = query.split(", ")
        if len(parts) >= 3:
            street_part = parts[0]
            city_part = ", ".join(parts[1:-1])
            result = nominatim_request(
                {
                    "street": street_part,
                    "city": city_part,
                    "country": "fr",
                    "format": "json",
                    "limit": 1,
                }
            )
    return result


def ensure_chantiers_adresse_column(cur) -> None:
    cur.execute("PRAGMA table_info(chantiers)")
    cols = {r[1] for r in cur.fetchall()}
    if "adresse" not in cols:
        cur.execute("ALTER TABLE chantiers ADD COLUMN adresse TEXT")


def ensure_chantiers_geo_columns(cur) -> None:
    cur.execute("PRAGMA table_info(chantiers)")
    cols = {r[1] for r in cur.fetchall()}
    if "latitude" not in cols:
        cur.execute("ALTER TABLE chantiers ADD COLUMN latitude REAL")
    if "longitude" not in cols:
        cur.execute("ALTER TABLE chantiers ADD COLUMN longitude REAL")


def populate_chantiers_adresse_from_libelle(conn, cur) -> int:
    """
    Remplit chantiers.adresse avec la voie extraite du libelle (regex + nettoyage),
    ou NULL si aucune voie reconnue.
    Retourne le nombre de lignes avec adresse non vide.
    """
    ensure_chantiers_adresse_column(cur)
    conn.commit()
    n_filled = 0
    # Ne pas iterer le SELECT sur le meme curseur que les UPDATE (sqlite3 n avance
    # pas correctement le curseur et une seule ligne peut etre traitee).
    rows = list(cur.execute("SELECT id, libelle FROM chantiers"))
    for row in rows:
        rid, libelle = row[0], row[1]
        addr = extract_street_from_libelle(libelle or "")
        cur.execute("UPDATE chantiers SET adresse = ? WHERE id = ?", (addr, rid))
        if addr:
            n_filled += 1
    conn.commit()
    return n_filled


def populate_chantiers_geocodes(
    conn,
    cur,
    cache_path: str,
    *,
    save_every_n_network: int = 10,
) -> Tuple[int, int, int]:
    """
    Remplit latitude/longitude pour les chantiers géocodables.
    Utilise uniquement la colonne ``adresse`` (déjà remplie depuis ``libelle`` par
    ``populate_chantiers_adresse_from_libelle``) : pas de re-extraction depuis le libellé ici.
    Retourne (nb_mis_a_jour, nb_ignores_sans_adresse, nb_appels_nominatim).
    """
    ensure_chantiers_adresse_column(cur)
    ensure_chantiers_geo_columns(cur)
    conn.commit()

    skip_network = os.environ.get("RTC_SKIP_GEOCODE", "").lower() in ("1", "true", "yes")

    raw_disk = load_disk_cache(cache_path)
    disk = clean_stale_cache_entries(raw_disk)
    if len(disk) < len(raw_disk):
        save_disk_cache(cache_path, disk)

    updated = 0
    skipped = 0
    nominatim_calls = 0

    cur.execute(
        "SELECT id, commune, latitude, longitude, adresse FROM chantiers"
    )
    rows = cur.fetchall()
    n_total = len(rows)
    print(
        f"[build] Geocodage chantiers : {n_total} ligne(s) "
        "(cache disque + Nominatim ~1,15 s par appel hors cache). "
        "Messages de progression toutes les ~15 s si c est long.",
        flush=True,
    )
    hb_last = time.perf_counter()
    hb_every = 15.0

    for idx, row in enumerate(
        _tqdm(
            rows,
            desc="Geocodage chantiers",
            unit="lig",
            total=n_total,
            leave=True,
            mininterval=0.15,
        ),
        start=1,
    ):
        now = time.perf_counter()
        if now - hb_last >= hb_every:
            msg = f"[build]   geocode actif : {idx}/{n_total} lignes, appels Nominatim cumules = {nominatim_calls}"
            try:
                from tqdm import tqdm as _tq_mod

                _tq_mod.write(msg)
            except Exception:
                print(msg, flush=True)
            hb_last = now

        rid, commune, lat, lon, adresse_col = (
            row[0],
            row[1],
            row[2],
            row[3],
            row[4],
        )
        if lat is not None and lon is not None:
            continue

        commune = (commune or "").strip()
        street = (adresse_col or "").strip() if adresse_col else ""
        if not street or not commune:
            skipped += 1
            continue

        full_q = f"{street}, {commune}, France"
        key = full_q.lower().strip()

        if key in disk:
            coords = disk[key]
        else:
            if skip_network:
                coords = None
            else:
                coords = geocode_full_query(full_q)
                disk[key] = coords
                nominatim_calls += 1
                if nominatim_calls % save_every_n_network == 0:
                    save_disk_cache(cache_path, disk)

        if coords and len(coords) >= 2:
            cur.execute(
                "UPDATE chantiers SET latitude = ?, longitude = ? WHERE id = ?",
                (coords[0], coords[1], rid),
            )
            updated += 1

    save_disk_cache(cache_path, disk)
    conn.commit()
    print(f"[build] Geocodage chantiers : fin du parcours ({n_total} lignes).", flush=True)
    return updated, skipped, nominatim_calls

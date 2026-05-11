from fastapi import APIRouter
import math
import re
import time
import json
import os
import threading
import urllib.request
import urllib.parse

from database import get_db


router = APIRouter(prefix="/api", tags=["GeoJSON"])


# ── Geocoding libelle → Nominatim ──────────────────────────────────────────────

_CACHE_PATH = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "database", "geocode_cache.json")
)
_cache: dict = {}
_cache_lock = threading.Lock()
_geo_thread: threading.Thread | None = None
_last_req_time = 0.0

# Bounding box stricte de Nice et proche périphérie
_LAT_MIN, _LAT_MAX = 43.58, 43.82
_LON_MIN, _LON_MAX = 7.10, 7.48

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


def _load_cache() -> None:
    global _cache
    try:
        if os.path.exists(_CACHE_PATH):
            with open(_CACHE_PATH, "r", encoding="utf-8") as f:
                _cache = json.load(f)
    except Exception:
        _cache = {}


def _save_cache() -> None:
    with _cache_lock:
        try:
            with open(_CACHE_PATH, "w", encoding="utf-8") as f:
                json.dump(_cache, f, ensure_ascii=False, indent=2)
        except Exception:
            pass


_load_cache()


def _extract_query(libelle: str) -> str | None:
    """Extrait un nom de voie depuis un libellé de chantier."""
    if not libelle:
        return None
    m = _STREET_RE.search(libelle)
    if not m:
        return None
    stype = m.group(1).strip()
    sname = m.group(2).strip()
    # Couper aux séparateurs forts (tiret entouré d'espaces, slash, parenthèse)
    for sep in (" - ", " / ", " (", ";", " : "):
        if sep in sname:
            sname = sname.split(sep)[0].strip()
    # Supprimer le bruit en fin (phase 2, tranche 1, nord, …)
    sname = _TRAILING_NOISE.sub("", sname).strip().rstrip(".,;:/- ")
    if len(sname) < 2:
        return None
    # Limiter à 50 caractères sur une frontière de mot
    if len(sname) > 50:
        sname = sname[:50].rsplit(" ", 1)[0]
    return f"{stype} {sname}"


def _geocode(query: str) -> list | None:
    """
    Géocode via Nominatim (OSM), bounded sur Nice.
    Respecte la limite 1 req/s. Cache persistant.
    Retourne [lat, lon] ou None.
    """
    global _last_req_time
    key = query.lower().strip()
    if key in _cache:
        return _cache[key]

    # Rate-limit : au moins 1.15 s entre deux appels
    elapsed = time.time() - _last_req_time
    if elapsed < 1.15:
        time.sleep(1.15 - elapsed)

    params = urllib.parse.urlencode({
        "q": f"{query}, Nice, France",
        "format": "json",
        "limit": 1,
        "countrycodes": "fr",
        # viewbox : lon_min,lat_max,lon_max,lat_min (top-left → bottom-right)
        "viewbox": f"{_LON_MIN},{_LAT_MAX},{_LON_MAX},{_LAT_MIN}",
        "bounded": 1,
    })
    req = urllib.request.Request(
        f"https://nominatim.openstreetmap.org/search?{params}",
        headers={"User-Agent": "RenovTaCana/2.1 (+epf-academic-project)"},
    )
    _last_req_time = time.time()

    try:
        with urllib.request.urlopen(req, timeout=7) as resp:
            results = json.loads(resp.read().decode())
    except Exception:
        return None

    if not results:
        result = None
    else:
        lat = float(results[0]["lat"])
        lon = float(results[0]["lon"])
        # Validation géographique : doit être dans l'emprise de Nice
        if _LAT_MIN <= lat <= _LAT_MAX and _LON_MIN <= lon <= _LON_MAX:
            result = [lat, lon]
        else:
            result = None

    _cache[key] = result
    _save_cache()
    return result


def _geocode_batch(queries: list) -> None:
    """Thread daemon : géocode les requêtes non encore en cache."""
    for q in queries:
        _geocode(q)


@router.get("/geojson/chantiers")
def get_geojson_chantiers():
    """
    Retourne un GeoJSON des chantiers localisés par leur libellé.
    Les chantiers non localisables ont geometry=null (non affichés côté client).
    Aucun fallback commune. La géocodage non-caché tourne en arrière-plan.
    """
    global _geo_thread

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "SELECT id, num_op, etat, date_debut, date_fin, libelle FROM chantiers"
    )
    rows = cur.fetchall()
    conn.close()

    features = []
    uncached: list[str] = []

    for row in rows:
        libelle = row["libelle"] or ""
        query = _extract_query(libelle)

        geom = None
        localise = False

        if query is not None:
            key = query.lower().strip()
            if key in _cache:
                coords = _cache[key]
                if coords:
                    # GeoJSON Point : [longitude, latitude]
                    geom = {"type": "Point", "coordinates": [coords[1], coords[0]]}
                    localise = True
            else:
                uncached.append(query)

        features.append({
            "type": "Feature",
            "geometry": geom,
            "properties": {
                "id": row["id"],
                "num_op": row["num_op"],
                "etat": row["etat"],
                "date_debut": row["date_debut"],
                "date_fin": row["date_fin"],
                "libelle": libelle,
                "localise": localise,
            },
        })

    # Dédupliquer et lancer le géocodage en arrière-plan pour les manquants
    unique_uncached = list(dict.fromkeys(uncached))
    if unique_uncached and (_geo_thread is None or not _geo_thread.is_alive()):
        _geo_thread = threading.Thread(
            target=_geocode_batch, args=(unique_uncached,), daemon=True
        )
        _geo_thread.start()

    return {"type": "FeatureCollection", "features": features}


@router.get("/geojson/canalisations")
def get_geojson_canalisations():
    """
    Construit un GeoJSON dynamique depuis la table `conduites`.
    """
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT FACILITYID, ADRESSE, MATERIAL, DIAMETER, longueur, Predicti_1, TXcasse, geometry
        FROM conduites
        WHERE geometry IS NOT NULL AND TRIM(geometry) != ''
        """
    )

    tx_to_pct = {
        "Négligeable": 5.0,
        "Negligeable": 5.0,
        "Faible": 25.0,
        "Moyen": 50.0,
        "Important": 75.0,
        "Très important": 95.0,
        "Tres important": 95.0,
    }

    features = []
    for row in cur.fetchall():
        geom = wkt_to_geojson_geometry(row["geometry"])
        if geom is None:
            continue

        pred = row["Predicti_1"]
        crit = None
        if isinstance(pred, (int, float)):
            crit = round(float(pred) * 100.0, 1)
        elif row["TXcasse"] in tx_to_pct:
            crit = tx_to_pct[row["TXcasse"]]

        features.append(
            {
                "type": "Feature",
                "geometry": geom,
                "properties": {
                    "id": row["FACILITYID"],
                    "adr": row["ADRESSE"],
                    "mat": row["MATERIAL"],
                    "diam": row["DIAMETER"],
                    "long": row["longueur"],
                    "crit": crit,
                },
            }
        )

    conn.close()
    return {"type": "FeatureCollection", "features": features}


def wkt_to_geojson_geometry(wkt):
    if not wkt:
        return None
    txt = wkt.strip()
    upper = txt.upper()
    if upper.startswith("LINESTRING"):
        coords = parse_linestring(txt)
        return {"type": "LineString", "coordinates": coords} if coords else None
    if upper.startswith("MULTILINESTRING"):
        lines = parse_multilinestring(txt)
        return {"type": "MultiLineString", "coordinates": lines} if lines else None
    return None


def parse_linestring(wkt):
    body = wkt[wkt.find("(") + 1 : wkt.rfind(")")]
    parts = [p.strip() for p in body.split(",") if p.strip()]
    coords = []
    for part in parts:
        nums = part.split()
        if len(nums) < 2:
            continue
        x = float(nums[0])
        y = float(nums[1])
        lon, lat = lambert93_to_wgs84(x, y)
        coords.append([lon, lat])
    return coords


def parse_multilinestring(wkt):
    body = wkt[wkt.find("(") + 1 : wkt.rfind(")")]
    body = body.strip()
    lines = []
    level = 0
    start = 0
    for i, ch in enumerate(body):
        if ch == "(":
            if level == 0:
                start = i + 1
            level += 1
        elif ch == ")":
            level -= 1
            if level == 0:
                seg = body[start:i]
                coords = []
                for part in [p.strip() for p in seg.split(",") if p.strip()]:
                    nums = part.split()
                    if len(nums) < 2:
                        continue
                    x = float(nums[0])
                    y = float(nums[1])
                    lon, lat = lambert93_to_wgs84(x, y)
                    coords.append([lon, lat])
                if coords:
                    lines.append(coords)
    return lines


def lambert93_to_wgs84(x, y):
    # EPSG:2154 -> WGS84
    n = 0.725607765053267
    c = 11754255.426096
    xs = 700000.0
    ys = 12655612.049876
    lon_meridian = 3.0 * math.pi / 180.0
    e = 0.081819191042816

    r = math.hypot(x - xs, y - ys)
    gamma = math.atan((x - xs) / (ys - y))
    lon = lon_meridian + gamma / n
    lat_iso = -math.log(abs(r / c)) / n

    lat = 2.0 * math.atan(math.exp(lat_iso)) - math.pi / 2.0
    for _ in range(6):
        lat = (
            2.0
            * math.atan(
                ((1.0 + e * math.sin(lat)) / (1.0 - e * math.sin(lat))) ** (e / 2.0)
                * math.exp(lat_iso)
            )
            - math.pi / 2.0
        )

    return lon * 180.0 / math.pi, lat * 180.0 / math.pi
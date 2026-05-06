from fastapi import APIRouter
import math

from database import get_db


router = APIRouter(prefix="/api", tags=["GeoJSON"])


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
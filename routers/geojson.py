import os

from fastapi import APIRouter
from fastapi.responses import Response


router = APIRouter(prefix="/api", tags=["GeoJSON"])


@router.get("/geojson/canalisations")
def get_geojson_canalisations():
    """
    Sert le GeoJSON compressé gzip directement.
    """
    base_dir = os.path.dirname(os.path.dirname(__file__))
    path = os.path.join(base_dir, "assets", "data", "canalisations.geojson.gz")

    with open(path, "rb") as f:
        content = f.read()

    return Response(
        content=content,
        media_type="application/json",
        headers={
            "Content-Encoding": "gzip",
            "Cache-Control": "public, max-age=3600",
        },
    )
"""
RenovTaCana — Backend FastAPI
Base SQLite avec vraies données Métropole Nice Côte d'Azur
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from routers.canalisations import router as canalisations_router
from routers.dashboard import router as dashboard_router
from routers.plan_travaux import router as plan_travaux_router
from routers.stats import router as stats_router
from routers.chantiers import router as chantiers_router
from routers.operations import router as operations_router
from routers.filtres import router as filtres_router
from routers.geojson import router as geojson_router


app = FastAPI(title="RenovTaCana API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(canalisations_router)
app.include_router(dashboard_router)
app.include_router(plan_travaux_router)
app.include_router(stats_router)
app.include_router(chantiers_router)
app.include_router(operations_router)
app.include_router(filtres_router)
app.include_router(geojson_router)

app.mount("/", StaticFiles(directory=".", html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
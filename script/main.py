"""
RenovTaCana — Backend FastAPI
Base SQLite avec vraies données Métropole Nice Côte d'Azur
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from script.endpoints.canalisations import router as canalisations_router
from script.endpoints.dashboard import router as dashboard_router
from script.endpoints.database.compute_priority import router as compute_priority_router
from script.endpoints.stats import router as stats_router
from script.endpoints.chantiers import router as chantiers_router
from script.endpoints.operations import router as operations_router
from script.endpoints.filtres import router as filtres_router
from script.endpoints.geojson import router as geojson_router
from script.endpoints.database.database_versions import router as database_versions_router
from script.endpoints.database.rollback import router as rollback_router
from script.endpoints.database.import_chantiers import router as import_chantiers_router
from script.endpoints.database.import_operations import router as import_operations_router
from script.endpoints.database.import_pipe_ranking import router as import_pipe_ranking_router


app = FastAPI(title="RenovTaCana API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(canalisations_router)
app.include_router(dashboard_router)
app.include_router(compute_priority_router)
app.include_router(stats_router)
app.include_router(chantiers_router)
app.include_router(operations_router)
app.include_router(filtres_router)
app.include_router(geojson_router)
app.include_router(database_versions_router)
app.include_router(rollback_router)
app.include_router(import_chantiers_router)
app.include_router(import_operations_router)
app.include_router(import_pipe_ranking_router)

app.mount("/", StaticFiles(directory=".", html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("script.main:app", host="127.0.0.1", port=8000, reload=True)
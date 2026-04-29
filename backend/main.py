from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from loguru import logger

from backend.config import settings
from backend.utils.logger import configure_logging
from backend.api.routes import scenes, ndvi, tiles

configure_logging(log_level=settings.log_level, log_file=settings.log_file)

app = FastAPI(
    title="GeoAI NDVI API",
    description="NDVI vegetation health assessment using Sentinel-2 open data.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(scenes.router, prefix="/api")
app.include_router(ndvi.router,   prefix="/api")
app.include_router(tiles.router,  prefix="/api")

app.mount("/frontend", StaticFiles(directory="frontend"), name="frontend_assets")
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")


@app.on_event("startup")
async def startup():
    logger.info("GeoAI NDVI API started.")


@app.on_event("shutdown")
async def shutdown():
    logger.info("GeoAI NDVI API shutting down.")

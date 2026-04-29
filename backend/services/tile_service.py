"""
Tile service — thin wrapper kept for future extension (e.g. caching, auth).
Actual tile generation lives in backend/api/routes/tiles.py via rio-tiler.
"""

from pathlib import Path
from loguru import logger

from backend.config import settings


def cog_path_for_scene(scene_id: str) -> Path:
    return settings.cache_dir / f"{scene_id}_ndvi.tif"


def scene_is_cached(scene_id: str) -> bool:
    exists = cog_path_for_scene(scene_id).exists()
    logger.debug(f"Cache check for {scene_id}: {'hit' if exists else 'miss'}")
    return exists

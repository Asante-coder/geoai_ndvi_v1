from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any
from loguru import logger

from backend.services.stac_service import search_scenes

router = APIRouter(tags=["scenes"])


class AOIRequest(BaseModel):
    geometry: dict
    date_start: str
    date_end: str
    max_cloud: float = 20.0


@router.post("/scenes", summary="Search Sentinel-2 scenes for an AOI")
async def get_scenes(body: AOIRequest) -> list[dict[str, Any]]:
    try:
        return search_scenes(
            aoi_geojson=body.geometry,
            date_start=body.date_start,
            date_end=body.date_end,
            max_cloud=body.max_cloud,
        )
    except Exception as exc:
        logger.exception("Scene search failed")
        raise HTTPException(status_code=500, detail=str(exc))

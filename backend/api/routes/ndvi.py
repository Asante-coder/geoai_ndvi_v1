from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from loguru import logger

from backend.services.ndvi_service import compute_ndvi, sample_ndvi_at_point
from backend.config import settings

router = APIRouter(tags=["ndvi"])


class NDVIRequest(BaseModel):
    scene_id: str
    red_href: str
    nir_href: str
    geometry: dict


@router.post("/ndvi", summary="Compute NDVI for a selected scene + AOI")
async def run_ndvi(body: NDVIRequest):
    try:
        return compute_ndvi(
            scene_id=body.scene_id,
            red_href=body.red_href,
            nir_href=body.nir_href,
            aoi_geojson=body.geometry,
        )
    except Exception as exc:
        logger.exception("NDVI computation failed")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/ndvi/{scene_id}/value", summary="Sample NDVI value at a lat/lng point")
async def get_ndvi_value(
    scene_id: str,
    lat: float = Query(..., ge=-90,  le=90),
    lng: float = Query(..., ge=-180, le=180),
):
    cog_path = settings.cache_dir / f"{scene_id}_ndvi.tif"
    if not cog_path.exists():
        raise HTTPException(404, "NDVI not computed for this scene yet.")
    try:
        value = sample_ndvi_at_point(cog_path, lat, lng)
        return {"value": value, "category": _ndvi_category(value)}
    except Exception as exc:
        logger.exception("NDVI point sample failed")
        raise HTTPException(status_code=500, detail=str(exc))


def _ndvi_category(v: float | None) -> dict:
    if v is None:
        return {"label": "No data",                  "color": "#475569"}
    if v < -0.3:
        return {"label": "Sea / Deep water",         "color": "#0369a1"}
    if v < 0.0:
        return {"label": "Water / Bare rock",        "color": "#8B4513"}
    if v < 0.1:
        return {"label": "Bare soil / Urban",        "color": "#C8A87D"}
    if v < 0.2:
        return {"label": "Sparse / Stressed veg",    "color": "#FFFF99"}
    if v < 0.4:
        return {"label": "Low / Moderate veg",       "color": "#ADDD8E"}
    if v < 0.6:
        return {"label": "Healthy vegetation",       "color": "#41AB5D"}
    if v < 0.8:
        return {"label": "Dense / Vigorous veg",     "color": "#238B45"}
    return     {"label": "Very dense canopy",        "color": "#004529"}

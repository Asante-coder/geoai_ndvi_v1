from fastapi import APIRouter, HTTPException, Response
from loguru import logger
import numpy as np
from PIL import Image
import io

from rio_tiler.io import COGReader
from backend.config import settings
from backend.utils.color import ndvi_colormap

router = APIRouter(tags=["tiles"])


@router.get(
    "/tiles/{scene_id}/{z}/{x}/{y}.png",
    summary="XYZ map tile from NDVI COG",
    response_class=Response,
)
async def get_tile(scene_id: str, z: int, x: int, y: int):
    cog_path = settings.cache_dir / f"{scene_id}_ndvi.tif"

    if not cog_path.exists():
        raise HTTPException(404, "NDVI not yet computed for this scene. POST /api/ndvi first.")

    logger.debug(f"Serving tile z={z} x={x} y={y} for scene {scene_id}")

    with COGReader(str(cog_path)) as cog:
        tile_data = cog.tile(x, y, z, tilesize=settings.tile_size)

    ndvi_vals = tile_data.data[0]
    mask      = tile_data.mask

    cmap = ndvi_colormap()
    norm = (ndvi_vals + 1) / 2
    rgba = (cmap(norm) * 255).astype(np.uint8)
    rgba[:, :, 3] = np.where(mask == 0, 0, rgba[:, :, 3])

    img    = Image.fromarray(rgba, mode="RGBA")
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")

    return Response(content=buffer.getvalue(), media_type="image/png")

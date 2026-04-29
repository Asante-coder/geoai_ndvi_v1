from __future__ import annotations
from pathlib import Path

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.mask import mask as rio_mask
from rasterio.transform import rowcol
from pyproj import Transformer
from shapely.geometry import shape, mapping
from loguru import logger

from backend.config import settings


def compute_ndvi(
    scene_id: str,
    red_href: str,
    nir_href: str,
    aoi_geojson: dict,
) -> dict:
    cache_path = settings.cache_dir / f"{scene_id}_ndvi.tif"

    if cache_path.exists():
        logger.info(f"Cache hit — skipping recomputation: {cache_path}")
        return _load_stats(cache_path)

    logger.info(f"Computing NDVI for scene {scene_id}")

    red_array, transform, crs = _read_band(red_href, aoi_geojson)
    nir_array, _, _           = _read_band(nir_href, aoi_geojson)

    red = red_array.astype(np.float32)
    nir = nir_array.astype(np.float32)

    with np.errstate(invalid="ignore", divide="ignore"):
        ndvi = np.where(
            (nir + red) == 0,
            np.nan,
            (nir - red) / (nir + red),
        )

    ndvi = np.clip(ndvi, -1.0, 1.0)

    _write_cog(ndvi, transform, crs, cache_path)
    logger.info(f"NDVI COG written: {cache_path}")

    return _load_stats(cache_path)


def _read_band(href: str, aoi_geojson: dict) -> tuple[np.ndarray, any, CRS]:
    from pyproj import Transformer
    from shapely.ops import transform as shp_transform

    logger.debug(f"Reading band from {href}")
    with rasterio.open(href) as src:
        aoi_shape = shape(aoi_geojson)
        if src.crs.to_epsg() != 4326:
            transformer = Transformer.from_crs(4326, src.crs.to_epsg(), always_xy=True)
            aoi_proj = shp_transform(transformer.transform, aoi_shape)
        else:
            aoi_proj = aoi_shape

        arr, transform = rio_mask(src, [mapping(aoi_proj)], crop=True, nodata=0, all_touched=True)
        return arr[0], transform, src.crs


def _write_cog(ndvi: np.ndarray, transform, crs: CRS, output_path: Path) -> None:
    profile = {
        "driver":     "GTiff",
        "dtype":      "float32",
        "width":      ndvi.shape[1],
        "height":     ndvi.shape[0],
        "count":      1,
        "crs":        crs,
        "transform":  transform,
        "nodata":     np.nan,
        "tiled":      True,
        "blockxsize": 512,
        "blockysize": 512,
        "compress":   "deflate",
        "predictor":  3,
        "interleave": "band",
    }

    tmp_path = output_path.with_suffix(".tmp.tif")
    with rasterio.open(tmp_path, "w", **profile) as dst:
        dst.write(ndvi, 1)
        dst.build_overviews([2, 4, 8, 16, 32], Resampling.average)
        dst.update_tags(ns="rio_overview", resampling="average")

    from rio_cogeo.cogeo import cog_translate
    from rio_cogeo.profiles import cog_profiles
    cog_translate(tmp_path, output_path, cog_profiles.get("deflate"), quiet=True)
    tmp_path.unlink(missing_ok=True)


def _load_stats(cog_path: Path) -> dict:
    with rasterio.open(cog_path) as src:
        data = src.read(1, masked=True)

    valid = data.compressed()
    if valid.size == 0:
        logger.warning(f"No valid pixels in {cog_path}")
        return {"cog_path": str(cog_path), "stats": {}, "histogram": {}}

    counts, bin_edges = np.histogram(valid, bins=50, range=(-1, 1))
    bins = ((bin_edges[:-1] + bin_edges[1:]) / 2).tolist()

    stats = {
        "min":            float(np.nanmin(valid)),
        "max":            float(np.nanmax(valid)),
        "mean":           float(np.nanmean(valid)),
        "std":            float(np.nanstd(valid)),
        "p10":            float(np.nanpercentile(valid, 10)),
        "p25":            float(np.nanpercentile(valid, 25)),
        "median":         float(np.nanmedian(valid)),
        "p75":            float(np.nanpercentile(valid, 75)),
        "p90":            float(np.nanpercentile(valid, 90)),
        "pixel_count":    int(valid.size),
        "vegetation_pct": float(np.sum(valid > 0.3) / valid.size * 100),
    }

    return {
        "cog_path":  str(cog_path),
        "stats":     stats,
        "histogram": {"bins": bins, "counts": counts.tolist()},
    }


def sample_ndvi_at_point(cog_path: Path, lat: float, lng: float) -> float | None:
    """Return the NDVI float value at a WGS-84 coordinate, or None if nodata."""
    with rasterio.open(cog_path) as src:
        # Reproject the click point from WGS-84 to the COG CRS if needed
        if src.crs.to_epsg() != 4326:
            transformer = Transformer.from_crs(4326, src.crs.to_epsg(), always_xy=True)
            x, y = transformer.transform(lng, lat)
        else:
            x, y = lng, lat

        row, col = rowcol(src.transform, x, y)

        # Bounds check
        if not (0 <= row < src.height and 0 <= col < src.width):
            logger.debug(f"Point ({lat},{lng}) is outside raster bounds")
            return None

        value = src.read(1, window=rasterio.windows.Window(col, row, 1, 1))[0, 0]

    if np.isnan(value) or value == src.nodata:
        return None

    return round(float(np.clip(value, -1.0, 1.0)), 4)

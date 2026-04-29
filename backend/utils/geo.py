from shapely.geometry import shape
from shapely.validation import make_valid
from loguru import logger


def validated_shape(geojson: dict):
    geom = shape(geojson)
    if not geom.is_valid:
        logger.warning("AOI geometry is invalid — applying make_valid fix.")
        geom = make_valid(geom)
    return geom


def aoi_area_degrees_sq(geojson: dict) -> float:
    return validated_shape(geojson).area

from __future__ import annotations
from typing import Any

import pystac_client
from loguru import logger
from shapely.geometry import mapping, shape

from backend.config import settings


def search_scenes(
    aoi_geojson: dict,
    date_start: str,
    date_end: str,
    max_cloud: float | None = None,
) -> list[dict[str, Any]]:
    cloud_threshold = max_cloud if max_cloud is not None else settings.max_cloud_cover
    logger.info(f"Searching STAC — dates={date_start}/{date_end}, cloud<{cloud_threshold}%")

    catalog = pystac_client.Client.open(settings.stac_endpoint)

    search = catalog.search(
        collections=[settings.collection],
        intersects=aoi_geojson,
        datetime=f"{date_start}/{date_end}",
        query={"eo:cloud_cover": {"lt": cloud_threshold}},
        max_items=50,
        # sortby="-datetime" omitted — Element84 endpoint does not support datetime sorting
    )

    scenes = []
    for item in search.items():
        assets  = item.assets
        red_key = _find_asset(assets, ["red", "B04", "B4"])
        nir_key = _find_asset(assets, ["nir", "B08", "B8"])

        if not red_key or not nir_key:
            logger.warning(f"Scene {item.id} missing red/NIR bands — skipped.")
            continue

        cloud_cover = item.properties.get("eo:cloud_cover", -1)

        # Client-side cloud cover guard in case server-side query filter is ignored
        if cloud_cover > cloud_threshold:
            continue

        scenes.append({
            "id":            item.id,
            "datetime":      item.datetime.isoformat() if item.datetime else None,
            "cloud_cover":   cloud_cover,
            "thumbnail_url": assets["thumbnail"].href if "thumbnail" in assets else None,
            "bbox":          item.bbox,
            "red_href":      assets[red_key].href,
            "nir_href":      assets[nir_key].href,
        })

    # Sort newest first client-side
    scenes.sort(key=lambda s: s["datetime"] or "", reverse=True)

    logger.info(f"Found {len(scenes)} usable scenes.")
    return scenes


def _find_asset(assets: dict, candidates: list[str]) -> str | None:
    for key in candidates:
        if key in assets:
            return key
    return None

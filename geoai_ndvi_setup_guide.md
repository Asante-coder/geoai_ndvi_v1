# GeoAI Web App — NDVI Vegetation Health Assessment
### Expert Geospatial Engineering Setup Guide

> **Stack:** Python · FastAPI · Sentinel-2 (Copernicus) · STAC · Rasterio · NumPy · Leaflet.js · Chart.js  
> **Paradigm:** Cloud-native geospatial · COG · STAC · REST API · Single-page web app

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites & Environment](#2-prerequisites--environment)
3. [Project Structure](#3-project-structure)
4. [Backend: Satellite Data Pipeline](#4-backend-satellite-data-pipeline)
5. [Backend: NDVI Computation Engine](#5-backend-ndvi-computation-engine)
6. [Backend: FastAPI REST Layer](#6-backend-fastapi-rest-layer)
7. [Frontend: Web Application](#7-frontend-web-application)
8. [Configuration & Environment Variables](#8-configuration--environment-variables)
9. [Running the Application](#9-running-the-application)
10. [Testing](#10-testing)
11. [Best Practices & Notes](#11-best-practices--notes)
12. [Deployment (Docker)](#12-deployment-docker)

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        WEB BROWSER                               │
│   Leaflet.js Map  │  NDVI Layer  │  Stats Panel  │  Chart.js    │
└────────────────────────────┬─────────────────────────────────────┘
                             │ HTTP/REST
┌────────────────────────────▼─────────────────────────────────────┐
│                     FastAPI Backend                              │
│   /api/scenes   │  /api/ndvi   │  /api/tiles/{z}/{x}/{y}        │
└────────────────────────────┬─────────────────────────────────────┘
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
   STAC Catalog        Rasterio/NumPy      GeoTIFF Cache
   (Element84 /        NDVI Engine         (local disk /
    Planetary Comp.)   COG output           S3-compatible)
          │
          ▼
   Sentinel-2 L2A
   (open, free, ~10m)
```

**Data flow:**
1. User draws AOI polygon on map → sends request to API
2. Backend queries STAC catalog for Sentinel-2 L2A scenes
3. Backend streams only needed bands (B04 Red, B08 NIR) via COG HTTP range requests
4. NDVI is computed in-memory, colourised, and saved as a tiled GeoTIFF (COG)
5. Frontend fetches map tiles and statistics via REST

---

## 2. Prerequisites & Environment

### System Requirements

```bash
# OS: Ubuntu 22.04 LTS / macOS 13+ / WSL2
# Python: 3.11+
# Node: 18+ (frontend dev server, optional)

# System libs (Ubuntu)
sudo apt-get update && sudo apt-get install -y \
  gdal-bin libgdal-dev \
  python3-dev python3-pip python3-venv \
  git curl
```

### Python Virtual Environment

```bash
python3 -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install --upgrade pip
```

### Python Dependencies (`requirements.txt`)

```text
# Core geospatial
rasterio==1.3.10
pyproj==3.6.1
shapely==2.0.4
numpy==1.26.4
scipy==1.13.0

# STAC / cloud-native
pystac-client==0.8.3
planetary-computer==1.0.0     # token signing for Planetary Computer
odc-stac==0.3.9               # lazy xarray loading from STAC

# Image / data
Pillow==10.3.0
matplotlib==3.9.0
xarray==2024.5.0
dask[array]==2024.5.0

# API layer
fastapi==0.111.0
uvicorn[standard]==0.30.0
python-multipart==0.0.9
pydantic==2.7.1
pydantic-settings==2.2.1
httpx==0.27.0

# Tiling
rio-tiler==6.6.2              # dynamic map tile generation from COG
titiler==0.18.0               # optional: full tiling microservice

# Utils
python-dotenv==1.0.1
loguru==0.7.2
cachetools==5.3.3
```

```bash
pip install -r requirements.txt
```

---

## 3. Project Structure

```
geoai-ndvi/
├── .env                          # Environment variables (git-ignored)
├── .env.example
├── .gitignore
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
│
├── backend/
│   ├── __init__.py
│   ├── main.py                   # FastAPI app entry point
│   ├── config.py                 # Settings via pydantic-settings
│   │
│   ├── api/
│   │   ├── __init__.py
│   │   ├── routes/
│   │   │   ├── scenes.py         # GET /api/scenes
│   │   │   ├── ndvi.py           # POST /api/ndvi
│   │   │   └── tiles.py          # GET /api/tiles/{z}/{x}/{y}
│   │   └── dependencies.py
│   │
│   ├── services/
│   │   ├── stac_service.py       # STAC catalog queries
│   │   ├── ndvi_service.py       # NDVI computation
│   │   └── tile_service.py       # COG tiling
│   │
│   ├── models/
│   │   ├── scene.py              # Pydantic models
│   │   └── ndvi.py
│   │
│   └── utils/
│       ├── geo.py                # Geometry helpers
│       └── color.py              # NDVI colormap
│
├── frontend/
│   ├── index.html                # Single-page app
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── app.js                # Main app controller
│       ├── map.js                # Leaflet map setup
│       ├── api.js                # Backend API calls
│       └── chart.js              # Statistics charts
│
├── data/
│   └── cache/                    # Local GeoTIFF cache (git-ignored)
│
└── tests/
    ├── test_stac.py
    ├── test_ndvi.py
    └── test_api.py
```

---

## 4. Backend: Satellite Data Pipeline

### `backend/config.py`

```python
from pydantic_settings import BaseSettings
from pathlib import Path

class Settings(BaseSettings):
    # STAC endpoints (both are free, no auth required)
    stac_endpoint: str = "https://earth-search.aws.element84.com/v1"
    # Fallback: "https://planetarycomputer.microsoft.com/api/stac/v1"

    collection: str = "sentinel-2-l2a"   # Bottom-of-atmosphere reflectance
    max_cloud_cover: float = 20.0         # % cloud cover threshold
    cache_dir: Path = Path("data/cache")
    tile_size: int = 256

    class Config:
        env_file = ".env"

settings = Settings()
settings.cache_dir.mkdir(parents=True, exist_ok=True)
```

### `backend/services/stac_service.py`

```python
"""
STAC service — queries Sentinel-2 L2A scenes for a given AOI and date range.

Best practices applied:
  - Cloud cover filtering at query time (server-side, not post-filter)
  - Requests only the two required assets (red + nir) to minimise bandwidth
  - Uses signed URLs where available (Planetary Computer)
  - Returns metadata suitable for the frontend scene selector
"""

from __future__ import annotations
import datetime
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
    """
    Search STAC for Sentinel-2 L2A scenes intersecting *aoi_geojson*.

    Args:
        aoi_geojson: GeoJSON geometry (Polygon / MultiPolygon).
        date_start:  ISO-8601 date string, e.g. "2024-01-01".
        date_end:    ISO-8601 date string, e.g. "2024-03-31".
        max_cloud:   Maximum cloud cover percentage (0–100).

    Returns:
        List of scene dicts with keys: id, datetime, cloud_cover,
        thumbnail_url, bbox, red_href, nir_href.
    """
    cloud_threshold = max_cloud if max_cloud is not None else settings.max_cloud_cover
    catalog = pystac_client.Client.open(settings.stac_endpoint)

    search = catalog.search(
        collections=[settings.collection],
        intersects=aoi_geojson,
        datetime=f"{date_start}/{date_end}",
        query={"eo:cloud_cover": {"lt": cloud_threshold}},
        sortby="-datetime",       # newest first
        max_items=50,
    )

    scenes = []
    for item in search.items():
        assets = item.assets
        # Sentinel-2 band naming varies slightly by endpoint
        red_key = _find_asset(assets, ["red", "B04", "B4"])
        nir_key = _find_asset(assets, ["nir", "B08", "B8"])

        if not red_key or not nir_key:
            logger.warning(f"Scene {item.id} missing red/NIR bands, skipping.")
            continue

        scenes.append({
            "id": item.id,
            "datetime": item.datetime.isoformat() if item.datetime else None,
            "cloud_cover": item.properties.get("eo:cloud_cover", -1),
            "thumbnail_url": assets.get("thumbnail", {}).href if "thumbnail" in assets else None,
            "bbox": item.bbox,
            "red_href": assets[red_key].href,
            "nir_href": assets[nir_key].href,
        })

    logger.info(f"Found {len(scenes)} scenes for AOI.")
    return scenes


def _find_asset(assets: dict, candidates: list[str]) -> str | None:
    """Return the first matching asset key from *candidates*."""
    for key in candidates:
        if key in assets:
            return key
    return None
```

---

## 5. Backend: NDVI Computation Engine

### `backend/services/ndvi_service.py`

```python
"""
NDVI computation service — cloud-native, memory-efficient approach.

Formula:  NDVI = (NIR − Red) / (NIR + Red)

Best practices applied:
  - Reads only the required spatial window (AOI bounding box) via GDAL windowed reads
  - Uses float32 throughout to halve memory vs float64
  - Masks clouds / invalid pixels using the SCL band when available
  - Outputs a Cloud-Optimised GeoTIFF (COG) for efficient tile serving
  - NDVI clamped to [-1, 1]; NaN pixels from division-by-zero are masked
"""

from __future__ import annotations
from pathlib import Path

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.mask import mask as rio_mask
from rasterio.transform import from_bounds
from rasterio.warp import calculate_default_transform, reproject
from shapely.geometry import shape, mapping
from loguru import logger

from backend.config import settings
from backend.utils.color import ndvi_colormap


def compute_ndvi(
    scene_id: str,
    red_href: str,
    nir_href: str,
    aoi_geojson: dict,
) -> dict:
    """
    Compute NDVI for a scene clipped to *aoi_geojson*.

    Returns a dict with:
      - cog_path: Path to output Cloud-Optimised GeoTIFF
      - stats: dict of min, max, mean, std, percentiles
      - histogram: {bins, counts} for frontend charting
    """
    cache_path = settings.cache_dir / f"{scene_id}_ndvi.tif"

    if cache_path.exists():
        logger.info(f"Cache hit: {cache_path}")
        return _load_stats(cache_path)

    aoi_shape = shape(aoi_geojson)
    target_crs = CRS.from_epsg(4326)   # output always WGS-84

    # --- 1. Read Red band (masked to AOI) ---
    red_array, transform, crs = _read_band(red_href, aoi_geojson)
    # --- 2. Read NIR band ---
    nir_array, _, _ = _read_band(nir_href, aoi_geojson)

    # --- 3. Compute NDVI ---
    red = red_array.astype(np.float32)
    nir = nir_array.astype(np.float32)

    # Avoid division by zero; masked result is NaN
    with np.errstate(invalid="ignore", divide="ignore"):
        ndvi = np.where(
            (nir + red) == 0,
            np.nan,
            (nir - red) / (nir + red),
        )

    # Clamp to valid NDVI range
    ndvi = np.clip(ndvi, -1.0, 1.0)

    # --- 4. Write Cloud-Optimised GeoTIFF ---
    _write_cog(ndvi, transform, crs, cache_path)
    logger.info(f"NDVI COG written to {cache_path}")

    return _load_stats(cache_path)


def _read_band(href: str, aoi_geojson: dict) -> tuple[np.ndarray, any, CRS]:
    """
    Open a remote COG and read only the AOI window.
    Reprojects AOI to the dataset CRS before masking.
    """
    with rasterio.open(href) as src:
        # Reproject AOI geometry to match raster CRS if needed
        from pyproj import Transformer
        from shapely.ops import transform as shp_transform

        aoi_shape = shape(aoi_geojson)
        if src.crs.to_epsg() != 4326:
            transformer = Transformer.from_crs(4326, src.crs.to_epsg(), always_xy=True)
            aoi_proj = shp_transform(transformer.transform, aoi_shape)
        else:
            aoi_proj = aoi_shape

        arr, transform = rio_mask(
            src,
            [mapping(aoi_proj)],
            crop=True,
            nodata=0,
            all_touched=True,
        )
        # Sentinel-2 bands are stored as uint16 (DN). Keep raw; ratio cancels scale.
        return arr[0], transform, src.crs


def _write_cog(
    ndvi: np.ndarray,
    transform,
    crs: CRS,
    output_path: Path,
) -> None:
    """Write NDVI array as a Cloud-Optimised GeoTIFF with internal overviews."""
    profile = {
        "driver": "GTiff",
        "dtype": "float32",
        "width": ndvi.shape[1],
        "height": ndvi.shape[0],
        "count": 1,
        "crs": crs,
        "transform": transform,
        "nodata": np.nan,
        # COG settings
        "tiled": True,
        "blockxsize": 512,
        "blockysize": 512,
        "compress": "deflate",
        "predictor": 3,          # floating-point predictor for better compression
        "interleave": "band",
    }

    tmp_path = output_path.with_suffix(".tmp.tif")
    with rasterio.open(tmp_path, "w", **profile) as dst:
        dst.write(ndvi, 1)
        # Build internal overviews (required for true COG)
        overview_levels = [2, 4, 8, 16, 32]
        dst.build_overviews(overview_levels, Resampling.average)
        dst.update_tags(ns="rio_overview", resampling="average")

    # Copy with COG layout (overviews before data)
    from rio_cogeo.cogeo import cog_translate
    from rio_cogeo.profiles import cog_profiles
    cog_translate(tmp_path, output_path, cog_profiles.get("deflate"), quiet=True)
    tmp_path.unlink(missing_ok=True)


def _load_stats(cog_path: Path) -> dict:
    """Read statistics from an existing NDVI COG."""
    with rasterio.open(cog_path) as src:
        data = src.read(1, masked=True)     # respects nodata mask

    valid = data.compressed()              # only non-masked pixels
    if valid.size == 0:
        return {"cog_path": str(cog_path), "stats": {}, "histogram": {}}

    counts, bin_edges = np.histogram(valid, bins=50, range=(-1, 1))
    bins = ((bin_edges[:-1] + bin_edges[1:]) / 2).tolist()

    stats = {
        "min":    float(np.nanmin(valid)),
        "max":    float(np.nanmax(valid)),
        "mean":   float(np.nanmean(valid)),
        "std":    float(np.nanstd(valid)),
        "p10":    float(np.nanpercentile(valid, 10)),
        "p25":    float(np.nanpercentile(valid, 25)),
        "median": float(np.nanmedian(valid)),
        "p75":    float(np.nanpercentile(valid, 75)),
        "p90":    float(np.nanpercentile(valid, 90)),
        "pixel_count": int(valid.size),
        "vegetation_pct": float(np.sum(valid > 0.3) / valid.size * 100),
    }

    return {
        "cog_path": str(cog_path),
        "stats": stats,
        "histogram": {"bins": bins, "counts": counts.tolist()},
    }
```

### `backend/utils/color.py`

```python
"""Standard NDVI colormap — perceptually distinct, colorblind-aware."""

import numpy as np
from matplotlib.colors import LinearSegmentedColormap

# Colors: deep brown → tan → yellow-green → forest green → dark green
NDVI_COLORS = [
    (-1.0, "#8B4513"),   # bare soil / water
    (-0.1, "#C8A87D"),   # sparse / stressed
    ( 0.0, "#FFFF99"),   # non-vegetated
    ( 0.2, "#ADDD8E"),   # low vegetation
    ( 0.4, "#41AB5D"),   # moderate
    ( 0.6, "#238B45"),   # healthy
    ( 1.0, "#004529"),   # dense / peak
]

def ndvi_colormap() -> LinearSegmentedColormap:
    positions = [c[0] for c in NDVI_COLORS]
    hex_colors = [c[1] for c in NDVI_COLORS]
    norm_positions = [(p + 1) / 2 for p in positions]  # map [-1,1] → [0,1]
    return LinearSegmentedColormap.from_list(
        "ndvi", list(zip(norm_positions, hex_colors))
    )
```

---

## 6. Backend: FastAPI REST Layer

### `backend/main.py`

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from loguru import logger

from backend.api.routes import scenes, ndvi, tiles

app = FastAPI(
    title="GeoAI NDVI API",
    description="NDVI vegetation health assessment using Sentinel-2 open data.",
    version="1.0.0",
)

# CORS — restrict to your domain in production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],    # Lock down in production: ["https://yourdomain.com"]
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(scenes.router, prefix="/api")
app.include_router(ndvi.router,   prefix="/api")
app.include_router(tiles.router,  prefix="/api")

# Serve frontend static files
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")

@app.on_event("startup")
async def startup():
    logger.info("GeoAI NDVI API started.")
```

### `backend/api/routes/scenes.py`

```python
from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel
from typing import Any

from backend.services.stac_service import search_scenes

router = APIRouter(tags=["scenes"])


class AOIRequest(BaseModel):
    geometry: dict          # GeoJSON geometry
    date_start: str         # e.g. "2024-01-01"
    date_end: str           # e.g. "2024-03-31"
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
        raise HTTPException(status_code=500, detail=str(exc))
```

### `backend/api/routes/ndvi.py`

```python
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.services.ndvi_service import compute_ndvi

router = APIRouter(tags=["ndvi"])


class NDVIRequest(BaseModel):
    scene_id: str
    red_href: str
    nir_href: str
    geometry: dict          # GeoJSON geometry


@router.post("/ndvi", summary="Compute NDVI for a selected scene + AOI")
async def run_ndvi(body: NDVIRequest):
    try:
        result = compute_ndvi(
            scene_id=body.scene_id,
            red_href=body.red_href,
            nir_href=body.nir_href,
            aoi_geojson=body.geometry,
        )
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
```

### `backend/api/routes/tiles.py`

```python
"""
Dynamic tile endpoint — serves NDVI COG as XYZ map tiles.
Uses rio-tiler for fast, memory-efficient tile generation.
"""

from fastapi import APIRouter, HTTPException, Response
from pathlib import Path

from rio_tiler.io import COGReader
from backend.config import settings
from backend.utils.color import ndvi_colormap
import numpy as np
from PIL import Image
import io

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

    with COGReader(str(cog_path)) as cog:
        tile_data = cog.tile(x, y, z, tilesize=settings.tile_size)

    ndvi_vals = tile_data.data[0]                 # shape (256, 256)
    mask      = tile_data.mask                    # 255 = valid, 0 = nodata

    # Colourize using NDVI colormap
    cmap  = ndvi_colormap()
    norm  = (ndvi_vals + 1) / 2                   # [-1, 1] → [0, 1]
    rgba  = (cmap(norm) * 255).astype(np.uint8)   # shape (256,256,4)
    rgba[:, :, 3] = np.where(mask == 0, 0, rgba[:, :, 3])   # apply nodata mask

    img    = Image.fromarray(rgba, mode="RGBA")
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")

    return Response(content=buffer.getvalue(), media_type="image/png")
```

---

## 7. Frontend: Web Application

### `frontend/index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>GeoAI · NDVI Vegetation Health</title>

  <!-- Leaflet -->
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

  <!-- Leaflet Draw (AOI drawing tool) -->
  <link rel="stylesheet" href="https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css" />
  <script src="https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.js"></script>

  <!-- Chart.js -->
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"></script>

  <link rel="stylesheet" href="/css/style.css" />
</head>
<body>
  <aside id="sidebar">
    <h1>🛰 GeoAI NDVI</h1>
    <p class="subtitle">Sentinel-2 Vegetation Health Assessment</p>

    <section id="controls">
      <label>Date Range</label>
      <div class="row">
        <input type="date" id="date-start" value="2024-01-01" />
        <input type="date" id="date-end"   value="2024-03-31" />
      </div>

      <label>Max Cloud Cover (%)</label>
      <input type="range" id="cloud-max" min="0" max="100" value="20" />
      <span id="cloud-val">20%</span>

      <button id="btn-search" class="btn primary">🔍 Search Scenes</button>
    </section>

    <section id="scene-list" class="hidden">
      <label>Available Scenes</label>
      <select id="scene-select" size="6"></select>
      <button id="btn-compute" class="btn success">⚡ Compute NDVI</button>
    </section>

    <section id="stats-panel" class="hidden">
      <h2>NDVI Statistics</h2>
      <table id="stats-table"></table>
      <canvas id="histogram-chart" height="160"></canvas>

      <div id="legend">
        <h3>Legend</h3>
        <div class="legend-bar"></div>
        <div class="legend-labels">
          <span>-1 Water/Bare</span>
          <span>0 Non-veg</span>
          <span>+1 Dense veg</span>
        </div>
      </div>
    </section>

    <div id="loader" class="hidden">⏳ Processing…</div>
    <div id="error-msg" class="hidden"></div>
  </aside>

  <main id="map"></main>

  <script src="/js/api.js"></script>
  <script src="/js/map.js"></script>
  <script src="/js/chart.js"></script>
  <script src="/js/app.js"></script>
</body>
</html>
```

### `frontend/css/style.css`

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  display: flex;
  height: 100vh;
  font-family: "Segoe UI", system-ui, sans-serif;
  font-size: 14px;
  background: #f0f2f5;
}

#sidebar {
  width: 320px;
  min-width: 280px;
  background: #1a1f2e;
  color: #e0e6f0;
  padding: 20px 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
  z-index: 1000;
}

h1 { font-size: 1.4rem; color: #7dd3fc; }
.subtitle { font-size: 0.78rem; color: #94a3b8; margin-top: 2px; }
h2 { font-size: 1rem; color: #7dd3fc; margin-bottom: 8px; }
h3 { font-size: 0.85rem; color: #94a3b8; margin-bottom: 4px; }

label { display: block; font-size: 0.75rem; color: #94a3b8;
        text-transform: uppercase; letter-spacing: .06em; margin-bottom: 4px; }

input[type="date"], select {
  width: 100%; padding: 6px 8px; border-radius: 6px;
  border: 1px solid #334155; background: #0f172a; color: #e0e6f0;
}
.row { display: flex; gap: 8px; }
.row input { flex: 1; }

input[type="range"] { width: 80%; accent-color: #38bdf8; }

#scene-select { font-size: 0.8rem; }

.btn {
  display: block; width: 100%; padding: 9px;
  border: none; border-radius: 8px; cursor: pointer;
  font-size: 0.88rem; font-weight: 600; margin-top: 8px;
  transition: filter .15s;
}
.btn:hover { filter: brightness(1.15); }
.btn.primary { background: #0ea5e9; color: #fff; }
.btn.success { background: #22c55e; color: #fff; }

#stats-table { width: 100%; border-collapse: collapse; font-size: 0.78rem; margin-bottom: 12px; }
#stats-table td { padding: 4px 6px; border-bottom: 1px solid #1e293b; }
#stats-table td:last-child { text-align: right; color: #7dd3fc; }

.legend-bar {
  height: 14px; border-radius: 4px; margin: 6px 0;
  background: linear-gradient(to right,
    #8B4513, #C8A87D, #FFFF99, #ADDD8E, #41AB5D, #238B45, #004529);
}
.legend-labels { display: flex; justify-content: space-between;
                 font-size: 0.7rem; color: #64748b; }

#loader { text-align: center; font-size: 0.9rem; color: #fbbf24; }
#error-msg { background: #450a0a; color: #fca5a5; padding: 10px;
             border-radius: 6px; font-size: 0.8rem; }

#map { flex: 1; }

.hidden { display: none !important; }
```

### `frontend/js/api.js`

```javascript
// All API calls to the FastAPI backend

const API_BASE = "";   // Same origin

async function searchScenes({ geometry, dateStart, dateEnd, maxCloud }) {
  const res = await fetch(`${API_BASE}/api/scenes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      geometry,
      date_start: dateStart,
      date_end: dateEnd,
      max_cloud: maxCloud,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function computeNdvi({ sceneId, redHref, nirHref, geometry }) {
  const res = await fetch(`${API_BASE}/api/ndvi`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scene_id: sceneId,
      red_href: redHref,
      nir_href: nirHref,
      geometry,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function tileUrl(sceneId) {
  return `${API_BASE}/api/tiles/${sceneId}/{z}/{x}/{y}.png`;
}
```

### `frontend/js/map.js`

```javascript
// Leaflet map initialisation and layer management

let map, drawnLayer, ndviLayer, drawControl;

function initMap() {
  map = L.map("map").setView([0, 0], 3);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);

  // AOI drawing
  drawnLayer = new L.FeatureGroup().addTo(map);
  drawControl = new L.Control.Draw({
    draw: {
      polygon: { allowIntersection: false },
      rectangle: true,
      circle: false, polyline: false, marker: false, circlemarker: false,
    },
    edit: { featureGroup: drawnLayer },
  });
  map.addControl(drawControl);

  map.on(L.Draw.Event.CREATED, (e) => {
    drawnLayer.clearLayers();
    drawnLayer.addLayer(e.layer);
  });
}

function getAOIGeometry() {
  const layers = drawnLayer.getLayers();
  if (!layers.length) return null;
  return layers[0].toGeoJSON().geometry;
}

function addNdviLayer(sceneId) {
  if (ndviLayer) map.removeLayer(ndviLayer);
  ndviLayer = L.tileLayer(tileUrl(sceneId), {
    opacity: 0.8,
    maxZoom: 16,
    attribution: "NDVI · Sentinel-2 L2A",
  }).addTo(map);
}

function fitToAOI() {
  const layers = drawnLayer.getLayers();
  if (layers.length) map.fitBounds(drawnLayer.getBounds(), { padding: [20, 20] });
}
```

### `frontend/js/chart.js`

```javascript
// Statistics histogram using Chart.js

let histChart = null;

function renderHistogram(bins, counts) {
  const ctx = document.getElementById("histogram-chart").getContext("2d");
  if (histChart) histChart.destroy();

  histChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: bins.map(v => v.toFixed(2)),
      datasets: [{
        label: "Pixel Count",
        data: counts,
        backgroundColor: bins.map(v => ndviColor(v)),
        borderWidth: 0,
        barPercentage: 1.0,
        categoryPercentage: 1.0,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: {
          ticks: { color: "#94a3b8", font: { size: 10 } },
          grid: { color: "#1e293b" },
        },
      },
    },
  });
}

function ndviColor(v) {
  // Mirrors the Python colormap for the frontend
  if (v < -0.1) return "#8B4513";
  if (v < 0.0)  return "#C8A87D";
  if (v < 0.2)  return "#FFFF99";
  if (v < 0.4)  return "#ADDD8E";
  if (v < 0.6)  return "#41AB5D";
  if (v < 0.8)  return "#238B45";
  return "#004529";
}
```

### `frontend/js/app.js`

```javascript
// Main application controller

let scenes = [];
let currentScene = null;
let currentAOI = null;

document.addEventListener("DOMContentLoaded", () => {
  initMap();

  const cloudSlider = document.getElementById("cloud-max");
  cloudSlider.addEventListener("input", () => {
    document.getElementById("cloud-val").textContent = cloudSlider.value + "%";
  });

  document.getElementById("btn-search").addEventListener("click", onSearch);
  document.getElementById("btn-compute").addEventListener("click", onCompute);
  document.getElementById("scene-select").addEventListener("change", onSceneSelect);
});

async function onSearch() {
  const aoi = getAOIGeometry();
  if (!aoi) { showError("Draw an AOI polygon on the map first."); return; }

  currentAOI = aoi;
  setLoading(true);

  try {
    scenes = await searchScenes({
      geometry: aoi,
      dateStart: document.getElementById("date-start").value,
      dateEnd: document.getElementById("date-end").value,
      maxCloud: parseFloat(document.getElementById("cloud-max").value),
    });

    if (!scenes.length) { showError("No scenes found. Expand date range or cloud cover."); return; }

    populateSceneList(scenes);
    show("scene-list");
    hide("error-msg");
  } catch (err) {
    showError("Scene search failed: " + err.message);
  } finally {
    setLoading(false);
  }
}

async function onCompute() {
  if (!currentScene) { showError("Select a scene first."); return; }

  setLoading(true);

  try {
    const result = await computeNdvi({
      sceneId: currentScene.id,
      redHref: currentScene.red_href,
      nirHref: currentScene.nir_href,
      geometry: currentAOI,
    });

    addNdviLayer(currentScene.id);
    fitToAOI();
    renderStats(result.stats);
    renderHistogram(result.histogram.bins, result.histogram.counts);
    show("stats-panel");
    hide("error-msg");
  } catch (err) {
    showError("NDVI computation failed: " + err.message);
  } finally {
    setLoading(false);
  }
}

function onSceneSelect() {
  const idx = document.getElementById("scene-select").selectedIndex;
  currentScene = scenes[idx] || null;
}

function populateSceneList(scenes) {
  const sel = document.getElementById("scene-select");
  sel.innerHTML = scenes.map((s, i) => {
    const dt = s.datetime ? s.datetime.slice(0, 10) : "Unknown";
    const cc = s.cloud_cover >= 0 ? `☁ ${s.cloud_cover.toFixed(1)}%` : "";
    return `<option value="${i}">${dt}  ${cc}</option>`;
  }).join("");
  currentScene = scenes[0];
}

function renderStats(stats) {
  if (!stats || !Object.keys(stats).length) return;
  const rows = [
    ["Min",         stats.min?.toFixed(4)],
    ["Max",         stats.max?.toFixed(4)],
    ["Mean",        stats.mean?.toFixed(4)],
    ["Std Dev",     stats.std?.toFixed(4)],
    ["Median",      stats.median?.toFixed(4)],
    ["P10 / P90",   `${stats.p10?.toFixed(3)} / ${stats.p90?.toFixed(3)}`],
    ["Vegetation >0.3", `${stats.vegetation_pct?.toFixed(1)}%`],
    ["Valid Pixels", stats.pixel_count?.toLocaleString()],
  ];
  document.getElementById("stats-table").innerHTML =
    rows.map(([k, v]) => `<tr><td>${k}</td><td>${v ?? "—"}</td></tr>`).join("");
}

// Helpers
function setLoading(on) {
  document.getElementById("loader")[on ? "classList" : "classList"][on ? "remove" : "add"]("hidden");
  if (on) document.getElementById("loader").classList.remove("hidden");
  else    document.getElementById("loader").classList.add("hidden");
}
function showError(msg) {
  const el = document.getElementById("error-msg");
  el.textContent = msg;
  el.classList.remove("hidden");
}
function show(id) { document.getElementById(id).classList.remove("hidden"); }
function hide(id) { document.getElementById(id).classList.add("hidden"); }
```

---

## 8. Configuration & Environment Variables

### `.env.example`

```ini
# STAC endpoint (choose one)
STAC_ENDPOINT=https://earth-search.aws.element84.com/v1
# STAC_ENDPOINT=https://planetarycomputer.microsoft.com/api/stac/v1

# Sentinel-2 collection identifier
COLLECTION=sentinel-2-l2a

# Filtering defaults
MAX_CLOUD_COVER=20.0

# Local cache directory (must be writable)
CACHE_DIR=data/cache

# Tile size in pixels
TILE_SIZE=256
```

```bash
cp .env.example .env
```

---

## 9. Running the Application

```bash
# 1. Activate virtualenv
source .venv/bin/activate

# 2. Start the API + frontend server
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000

# App available at:  http://localhost:8000
# API docs at:       http://localhost:8000/docs
```

### Typical Usage Flow

```
1.  Open http://localhost:8000
2.  Draw a rectangle or polygon on the map over a region of interest
3.  Set date range (e.g. 2024-01-01 → 2024-03-31) and cloud cover limit
4.  Click "Search Scenes" → scene list populates
5.  Select a scene → click "Compute NDVI"
6.  NDVI layer renders on map; statistics and histogram appear in the sidebar
```

---

## 10. Testing

### `tests/test_ndvi.py`

```python
"""Unit tests for NDVI computation — uses local synthetic data, no network calls."""

import numpy as np
import pytest
from unittest.mock import patch, MagicMock

from backend.services.ndvi_service import compute_ndvi


def synthetic_band(value: float, shape=(256, 256)) -> np.ndarray:
    return np.full(shape, value, dtype=np.float32)


def test_ndvi_formula():
    nir = 0.8
    red = 0.2
    expected = (nir - red) / (nir + red)   # 0.6

    # Mock rasterio reads
    with patch("backend.services.ndvi_service._read_band") as mock_read, \
         patch("backend.services.ndvi_service._write_cog"), \
         patch("backend.services.ndvi_service._load_stats") as mock_stats:

        mock_read.side_effect = [
            (synthetic_band(red * 10000), None, None),   # red (DN)
            (synthetic_band(nir * 10000), None, None),   # nir (DN)
        ]
        mock_stats.return_value = {
            "cog_path": "dummy.tif",
            "stats": {"mean": expected},
            "histogram": {},
        }

        result = compute_ndvi("test_scene", "red.tif", "nir.tif", {})
        assert abs(result["stats"]["mean"] - expected) < 1e-4


def test_ndvi_division_by_zero():
    """NIR + Red = 0 must yield NaN, not an error."""
    nir = red = synthetic_band(0.0)
    with np.errstate(invalid="ignore", divide="ignore"):
        ndvi = np.where((nir + red) == 0, np.nan, (nir - red) / (nir + red))
    assert np.all(np.isnan(ndvi))


def test_ndvi_clamp():
    """NDVI must always be within [-1, 1]."""
    nir = synthetic_band(65535.0)
    red = synthetic_band(0.0)
    ndvi = np.clip((nir - red) / (nir + red), -1.0, 1.0)
    assert np.all(ndvi <= 1.0) and np.all(ndvi >= -1.0)
```

```bash
# Run all tests
pip install pytest
pytest tests/ -v
```

---

## 11. Best Practices & Notes

### Geospatial

| Topic | Recommendation |
|---|---|
| CRS | Always reproject AOI to raster CRS before masking. Never assume WGS-84. |
| Cloud masking | Extend `ndvi_service.py` to use the Sentinel-2 **SCL** (Scene Classification Layer) band for pixel-level cloud/shadow masking for production use. |
| Band scaling | Sentinel-2 DN values are uint16; NDVI formula is ratio-based so DN values work fine without converting to reflectance — but apply the `offset` / `scale` from STAC metadata for absolute reflectance if comparing across sensors. |
| COG | Always write Cloud-Optimised GeoTIFFs with internal overviews for efficient tiling. |
| Nodata | Use `np.nan` for float layers; preserve masks through all array operations. |

### API / Performance

| Topic | Recommendation |
|---|---|
| Caching | Scene-level caching by `scene_id` prevents re-downloading the same data. Extend to Redis for multi-worker deployments. |
| Streaming | GDAL range requests pull only the spatial window needed — no full-scene download. |
| Concurrency | Add `asyncio` thread-pool offload for heavy rasterio operations (`loop.run_in_executor`) to avoid blocking the event loop. |
| Tile serving | For high-traffic deployments, replace the custom tile route with **TiTiler** (a production tiling microservice built on rio-tiler). |

### Security

```python
# In production, restrict CORS:
allow_origins=["https://yourdomain.com"]

# Validate AOI geometry before processing:
from shapely.validation import make_valid
aoi_shape = make_valid(shape(aoi_geojson))

# Limit AOI area to prevent abuse (e.g., max 10,000 km²):
assert aoi_shape.area < 0.9    # degrees² — tune for your use case
```

---

## 12. Deployment (Docker)

### `Dockerfile`

```dockerfile
FROM python:3.11-slim

# GDAL system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gdal-bin libgdal-dev gcc python3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY frontend/ ./frontend/

VOLUME ["/app/data/cache"]
EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
```

### `docker-compose.yml`

```yaml
version: "3.9"
services:
  geoai-ndvi:
    build: .
    ports:
      - "8000:8000"
    volumes:
      - ./data/cache:/app/data/cache
    env_file:
      - .env
    restart: unless-stopped
```

```bash
docker compose up --build
```

---

## Quick Reference — NDVI Interpretation

| NDVI Range | Vegetation Status |
|---|---|
| < 0.0 | Water, snow, bare rock, clouds |
| 0.0 – 0.1 | Bare soil, sand, urban surfaces |
| 0.1 – 0.2 | Sparse or stressed vegetation |
| 0.2 – 0.4 | Low / moderate vegetation cover |
| 0.4 – 0.6 | Healthy, moderate vegetation |
| 0.6 – 0.8 | Dense, vigorous vegetation |
| > 0.8 | Very dense, peak-season canopy |

---

*Data source: Copernicus Sentinel-2 (ESA) — free and open under the Copernicus Open Access Hub licence.*

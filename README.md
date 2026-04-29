# GeoAI NDVI — Vegetation Health Assessment

A cloud-native geospatial web application for computing and visualising **NDVI (Normalised Difference Vegetation Index)** from free **Copernicus Sentinel-2 L2A** satellite imagery, with an interactive map, statistics dashboard, external data overlays, and downloadable reports.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Features](#features)
4. [Tech Stack](#tech-stack)
5. [Project Structure](#project-structure)
6. [Getting Started](#getting-started)
7. [Running the Application](#running-the-application)
8. [API Reference](#api-reference)
9. [NDVI Classification](#ndvi-classification)
10. [Testing](#testing)
11. [Docker Deployment](#docker-deployment)
12. [Configuration](#configuration)

---

## Overview

GeoAI NDVI lets you:

1. Draw an **Area of Interest (AOI)** polygon on a web map
2. Search for cloud-free **Sentinel-2 scenes** over that area
3. Compute **NDVI** on the fly using only the required spatial window (COG range requests — no full-scene download)
4. Visualise the result as a **colourised tile layer** on the map
5. **Click any pixel** to read its exact NDVI value and vegetation category
6. **Overlay external data** (GeoJSON, KML, Shapefiles) for context
7. **Export** a standalone HTML report or CSV statistics file

All satellite data is **free and open** — no account or API key required.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         WEB BROWSER                             │
│  Leaflet Map │ NDVI Layer │ Stats Panel │ Chart.js │ Uploads    │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP / REST
┌───────────────────────────▼─────────────────────────────────────┐
│                      FastAPI Backend                            │
│  POST /api/scenes   POST /api/ndvi   GET /api/tiles/{z}/{x}/{y} │
│  GET  /api/ndvi/{scene_id}/value                                │
└──────────┬────────────────┬────────────────────────┬────────────┘
           ▼                ▼                        ▼
    STAC Catalog      Rasterio / NumPy         GeoTIFF Cache
    (Element84)       NDVI Engine (COG)        data/cache/
           │
           ▼
    Sentinel-2 L2A
    (Copernicus / ESA — free, ~10 m resolution)
```

**Data flow:**

1. User draws an AOI → frontend calls `POST /api/scenes`
2. Backend queries the Element84 STAC catalog for cloud-free Sentinel-2 scenes
3. User selects a scene → frontend calls `POST /api/ndvi`
4. Backend streams only the required spatial window of Red (B04) and NIR (B08) bands via GDAL COG range requests
5. NDVI is computed in memory, saved as a Cloud-Optimised GeoTIFF, and statistics returned
6. Frontend loads XYZ tiles from `GET /api/tiles/…` and renders them on the map
7. Map clicks call `GET /api/ndvi/{scene_id}/value` to sample a single pixel

---

## Features

### Map
- Interactive **Leaflet** map with 5 switchable basemaps (OpenStreetMap, Satellite, Terrain, Dark, Light)
- **Draw AOI** using polygon or rectangle tools
- **Geocoder search** — find any place by name (Nominatim, no API key)
- Search results drop a **named marker** at the location
- NDVI layer rendered as colourised XYZ tiles at up to zoom 16

### NDVI Analysis
- Cloud-native processing — only the AOI window is downloaded, not the full scene
- Float32 precision, NaN masking for division-by-zero and nodata pixels
- Output saved as **Cloud-Optimised GeoTIFF (COG)** with internal overviews
- Scene-level **disk cache** — reloads instantly on repeated requests

### Click Tooltip
- Click anywhere on the NDVI layer to read:
  - Exact NDVI value (4 decimal places)
  - Position on the NDVI gradient bar
  - Colour-coded vegetation category label
- Shows a spinner while the pixel is being sampled

### Statistics Dashboard
- Min, Max, Mean, Std Dev, Median, P10, P25, P75, P90
- Vegetation cover percentage (NDVI > 0.3)
- Valid pixel count
- Colour-coded distribution histogram (Chart.js)

### External Data Layers
- Load **GeoJSON**, **KML**, or **zipped Shapefiles** via:
  - File picker button in the sidebar
  - Drag-and-drop onto the map
- Each layer auto-coloured, listed in the sidebar with a remove button
- Feature attributes shown in a popup on click

### Reports & Export
| Export | Content |
|---|---|
| **HTML Report** | Self-contained page with stats table, histogram chart, legend, scene metadata — print to PDF from the browser |
| **CSV Stats** | All NDVI statistics in a spreadsheet-ready format |

### Logging
- Structured log output to console and rotating log file (`logs/geoai_ndvi.log`)
- 10 MB rotation, 14-day retention, gzip compression
- Log level and file path configurable via `.env`

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Python 3.12, FastAPI, Uvicorn |
| **Satellite data** | Sentinel-2 L2A via Element84 STAC (`earth-search.aws.element84.com`) |
| **Geospatial** | Rasterio, pyproj, Shapely, NumPy, rio-tiler, rio-cogeo |
| **STAC client** | pystac-client, planetary-computer |
| **Frontend** | Vanilla JS, Leaflet.js 1.9, Chart.js 4.4 |
| **Geocoder** | leaflet-control-geocoder (Nominatim) |
| **File parsers** | shpjs (Shapefile), @mapbox/togeojson (KML) |
| **Logging** | loguru |
| **Config** | pydantic-settings, python-dotenv |
| **Testing** | pytest |
| **Deployment** | Docker, docker-compose |

---

## Project Structure

```
geoai_ndvi/
├── .env                        # Local environment variables (git-ignored)
├── .env.example                # Template for environment variables
├── .gitignore
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
├── run.bat                     # Windows startup script (sets PROJ_DATA + PATH)
├── run.ps1                     # PowerShell startup script
│
├── backend/
│   ├── main.py                 # FastAPI app entry point, logger init
│   ├── config.py               # Settings via pydantic-settings
│   │
│   ├── api/
│   │   ├── routes/
│   │   │   ├── scenes.py       # POST /api/scenes
│   │   │   ├── ndvi.py         # POST /api/ndvi, GET /api/ndvi/{id}/value
│   │   │   └── tiles.py        # GET /api/tiles/{scene_id}/{z}/{x}/{y}.png
│   │   └── dependencies.py
│   │
│   ├── services/
│   │   ├── stac_service.py     # STAC catalog queries, cloud filtering, client-side sort
│   │   ├── ndvi_service.py     # NDVI computation, COG writer, stats, point sampler
│   │   └── tile_service.py     # Cache helpers
│   │
│   ├── models/
│   │   ├── scene.py            # SceneMetadata Pydantic model
│   │   └── ndvi.py             # NDVIResult, NDVIStats, NDVIHistogram models
│   │
│   └── utils/
│       ├── logger.py           # configure_logging() — loguru sinks
│       ├── color.py            # NDVI LinearSegmentedColormap
│       └── geo.py              # AOI validation helpers
│
├── frontend/
│   ├── index.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── api.js              # fetch wrappers for all backend endpoints
│       ├── map.js              # Leaflet map, basemaps, geocoder, draw, NDVI click
│       ├── chart.js            # Chart.js histogram
│       ├── upload.js           # External file loader (GeoJSON / KML / Shapefile)
│       ├── report.js           # HTML report + CSV export generators
│       └── app.js              # Main controller, event wiring
│
├── data/
│   └── cache/                  # NDVI COG files cached here (git-ignored)
│
├── logs/                       # Rotating log files (git-ignored)
│
└── tests/
    ├── test_ndvi.py            # NDVI formula, clamp, division-by-zero unit tests
    ├── test_stac.py            # STAC asset lookup, scene filter tests
    └── test_api.py             # FastAPI route smoke tests
```

---

## Getting Started

### Prerequisites

| Requirement | Version |
|---|---|
| Conda environment | `geopandas-env` (Python 3.12) |
| PROJ data | Installed via `conda install -c conda-forge proj` |

### 1. Clone / open the project

```bash
cd geoai_ndvi
```

### 2. Copy the environment file

```bash
cp .env.example .env
```

The defaults work out of the box — no API keys needed.

### 3. Install missing packages (first time only)

```bash
conda activate geopandas-env
pip install python-multipart loguru dask[array] odc-stac planetary-computer titiler
```

> All other dependencies (`rasterio`, `fastapi`, `pystac-client`, `rio-tiler`, `rio-cogeo`, etc.) are already present in `geopandas-env`.

---

## Running the Application

> **Use the startup scripts**, not bare `uvicorn`. They set the `PROJ_DATA` path and include `Library/bin` in `PATH` so pyproj DLLs load correctly on Windows.

**Command Prompt / double-click:**
```
run.bat
```

**PowerShell:**
```powershell
.\run.ps1
```

The server starts on `http://localhost:8000`.

| URL | Description |
|---|---|
| `http://localhost:8000` | Web application |
| `http://localhost:8000/docs` | Interactive API docs (Swagger UI) |
| `http://localhost:8000/redoc` | API docs (ReDoc) |

### Typical workflow

```
1.  Open http://localhost:8000
2.  Draw a polygon or rectangle on the map over your area of interest
3.  Set a date range and max cloud cover, then click "Search Scenes"
4.  Select a scene from the list and click "Compute NDVI"
5.  The NDVI layer renders on the map — click any pixel for its value
6.  Download the HTML report or CSV stats from the statistics panel
7.  Optionally load a GeoJSON / KML / Shapefile to overlay boundaries
```

---

## API Reference

### `POST /api/scenes`
Search Sentinel-2 scenes for an AOI.

**Request body:**
```json
{
  "geometry":   { "type": "Polygon", "coordinates": [[[lng, lat], ...]] },
  "date_start": "2024-01-01",
  "date_end":   "2024-03-31",
  "max_cloud":  20.0
}
```

**Response:** Array of scene objects with `id`, `datetime`, `cloud_cover`, `bbox`, `red_href`, `nir_href`.

---

### `POST /api/ndvi`
Compute NDVI for a selected scene clipped to an AOI.

**Request body:**
```json
{
  "scene_id": "S2A_30NYM_20240331_0_L2A",
  "red_href": "https://...",
  "nir_href": "https://...",
  "geometry": { "type": "Polygon", "coordinates": [[[lng, lat], ...]] }
}
```

**Response:**
```json
{
  "cog_path": "data/cache/..._ndvi.tif",
  "stats": { "min": -0.12, "max": 0.81, "mean": 0.43, "vegetation_pct": 62.3, ... },
  "histogram": { "bins": [...], "counts": [...] }
}
```

---

### `GET /api/ndvi/{scene_id}/value`
Sample the NDVI value at a point.

**Query params:** `lat`, `lng`

**Response:**
```json
{
  "value": 0.5432,
  "category": { "label": "Healthy vegetation", "color": "#41AB5D" }
}
```

---

### `GET /api/tiles/{scene_id}/{z}/{x}/{y}.png`
Returns a 256×256 PNG tile colourised using the NDVI colormap.  
Standard Leaflet XYZ tile URL: `/api/tiles/{scene_id}/{z}/{x}/{y}.png`

---

## NDVI Classification

| NDVI Range | Class | Colour |
|---|---|:---:|
| ≤ −0.3 | Sea / Deep water | ![#0369a1](https://via.placeholder.com/12/0369a1/0369a1.png) `#0369a1` |
| −0.3 – 0.0 | Water / Bare rock | ![#8B4513](https://via.placeholder.com/12/8B4513/8B4513.png) `#8B4513` |
| 0.0 – 0.1 | Bare soil / Urban | ![#C8A87D](https://via.placeholder.com/12/C8A87D/C8A87D.png) `#C8A87D` |
| 0.1 – 0.2 | Sparse / Stressed veg | ![#FFFF99](https://via.placeholder.com/12/FFFF99/FFFF99.png) `#FFFF99` |
| 0.2 – 0.4 | Low / Moderate veg | ![#ADDD8E](https://via.placeholder.com/12/ADDD8E/ADDD8E.png) `#ADDD8E` |
| 0.4 – 0.6 | Healthy vegetation | ![#41AB5D](https://via.placeholder.com/12/41AB5D/41AB5D.png) `#41AB5D` |
| 0.6 – 0.8 | Dense / Vigorous veg | ![#238B45](https://via.placeholder.com/12/238B45/238B45.png) `#238B45` |
| > 0.8 | Very dense canopy | ![#004529](https://via.placeholder.com/12/004529/004529.png) `#004529` |

---

## Testing

```bash
conda activate geopandas-env
pip install pytest
pytest tests/ -v
```

| Test file | Coverage |
|---|---|
| `tests/test_ndvi.py` | NDVI formula correctness, division-by-zero, value clamping |
| `tests/test_stac.py` | Asset key lookup, missing-band filtering |
| `tests/test_api.py` | Route existence, 404 on missing scene |

---

## Docker Deployment

```bash
# Build and start
docker compose up --build

# App available at http://localhost:8000
```

The `docker-compose.yml` mounts `./data/cache` and `./logs` as volumes so cached COGs and logs persist across container restarts.

```yaml
volumes:
  - ./data/cache:/app/data/cache
  - ./logs:/app/logs
```

---

## Configuration

All settings are loaded from `.env` (copy from `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `STAC_ENDPOINT` | `https://earth-search.aws.element84.com/v1` | STAC API URL |
| `COLLECTION` | `sentinel-2-l2a` | Sentinel-2 collection ID |
| `MAX_CLOUD_COVER` | `20.0` | Default max cloud cover (%) |
| `CACHE_DIR` | `data/cache` | Local COG cache directory |
| `TILE_SIZE` | `256` | Map tile size in pixels |
| `LOG_LEVEL` | `INFO` | Logging level (`DEBUG`, `INFO`, `WARNING`) |
| `LOG_FILE` | `logs/geoai_ndvi.log` | Log file path (set to empty to disable) |

**Alternative STAC endpoint (Microsoft Planetary Computer):**
```ini
STAC_ENDPOINT=https://planetarycomputer.microsoft.com/api/stac/v1
```

---

## Known Issues & Notes

- **Windows only:** Must use `run.bat` or `run.ps1` to start the server. Running bare `uvicorn` will fail with a `PROJ DataDirError` because the conda activation hooks that set `PROJ_DATA` and `Library/bin` in PATH are bypassed.
- **Shapefile upload:** The `.zip` must contain `.shp`, `.dbf`, and `.prj` files at the root level.
- **Large AOIs:** Processing time scales with AOI area. For areas over ~1 000 km², expect 30–60 s on first compute.
- **STAC `sortby`:** The Element84 endpoint does not support server-side `sortby=datetime`. Scenes are sorted newest-first client-side after retrieval.

---

## Data Source

> Copernicus Sentinel-2 data — © ESA, free and open under the [Copernicus Open Access Hub licence](https://scihub.copernicus.eu/twiki/do/view/SciHubWebPortal/TermsConditions).

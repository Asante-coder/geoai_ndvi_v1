import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch

from backend.main import app

client = TestClient(app)


def test_ndvi_returns_404_for_unknown_scene():
    res = client.get("/api/tiles/nonexistent_scene/10/512/512.png")
    assert res.status_code == 404


def test_scenes_endpoint_exists():
    res = client.post("/api/scenes", json={
        "geometry":   {"type": "Polygon", "coordinates": [[[0,0],[1,0],[1,1],[0,1],[0,0]]]},
        "date_start": "2024-01-01",
        "date_end":   "2024-03-31",
        "max_cloud":  20.0,
    })
    # We expect either 200 (real network) or 500 (no network in CI) — not 404/405
    assert res.status_code in (200, 500)

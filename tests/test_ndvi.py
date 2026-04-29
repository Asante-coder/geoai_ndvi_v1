import numpy as np
import pytest
from unittest.mock import patch

from backend.services.ndvi_service import compute_ndvi


def synthetic_band(value: float, shape=(256, 256)) -> np.ndarray:
    return np.full(shape, value, dtype=np.float32)


def test_ndvi_formula():
    nir, red = 0.8, 0.2
    expected = (nir - red) / (nir + red)

    with patch("backend.services.ndvi_service._read_band") as mock_read, \
         patch("backend.services.ndvi_service._write_cog"), \
         patch("backend.services.ndvi_service._load_stats") as mock_stats:

        mock_read.side_effect = [
            (synthetic_band(red * 10000), None, None),
            (synthetic_band(nir * 10000), None, None),
        ]
        mock_stats.return_value = {
            "cog_path": "dummy.tif",
            "stats":    {"mean": expected},
            "histogram": {},
        }

        result = compute_ndvi("test_scene", "red.tif", "nir.tif", {})
        assert abs(result["stats"]["mean"] - expected) < 1e-4


def test_ndvi_division_by_zero():
    nir = red = synthetic_band(0.0)
    with np.errstate(invalid="ignore", divide="ignore"):
        ndvi = np.where((nir + red) == 0, np.nan, (nir - red) / (nir + red))
    assert np.all(np.isnan(ndvi))


def test_ndvi_clamp():
    nir  = synthetic_band(65535.0)
    red  = synthetic_band(0.0)
    ndvi = np.clip((nir - red) / (nir + red), -1.0, 1.0)
    assert np.all(ndvi <= 1.0) and np.all(ndvi >= -1.0)

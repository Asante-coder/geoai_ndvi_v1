import pytest
from unittest.mock import patch, MagicMock

from backend.services.stac_service import search_scenes, _find_asset


def test_find_asset_returns_first_match():
    assets = {"B04": MagicMock(), "red": MagicMock()}
    assert _find_asset(assets, ["red", "B04"]) == "red"


def test_find_asset_returns_none_when_missing():
    assets = {"B08": MagicMock()}
    assert _find_asset(assets, ["red", "B04"]) is None


def test_search_scenes_skips_missing_bands():
    mock_item = MagicMock()
    mock_item.assets = {"B08": MagicMock()}  # NIR only, no red
    mock_item.id = "scene_001"

    with patch("backend.services.stac_service.pystac_client.Client.open") as mock_client:
        mock_client.return_value.search.return_value.items.return_value = [mock_item]
        result = search_scenes({}, "2024-01-01", "2024-03-31")

    assert result == []

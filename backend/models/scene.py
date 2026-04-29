from pydantic import BaseModel
from typing import Any


class SceneMetadata(BaseModel):
    id: str
    datetime: str | None
    cloud_cover: float
    thumbnail_url: str | None
    bbox: list[float]
    red_href: str
    nir_href: str

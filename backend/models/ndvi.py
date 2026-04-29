from pydantic import BaseModel
from typing import Any


class NDVIStats(BaseModel):
    min: float
    max: float
    mean: float
    std: float
    p10: float
    p25: float
    median: float
    p75: float
    p90: float
    pixel_count: int
    vegetation_pct: float


class NDVIHistogram(BaseModel):
    bins: list[float]
    counts: list[int]


class NDVIResult(BaseModel):
    cog_path: str
    stats: NDVIStats | dict
    histogram: NDVIHistogram | dict

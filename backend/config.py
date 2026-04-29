from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    stac_endpoint: str = "https://earth-search.aws.element84.com/v1"
    collection: str = "sentinel-2-l2a"
    max_cloud_cover: float = 20.0
    cache_dir: Path = Path("data/cache")
    tile_size: int = 256

    log_level: str = "INFO"
    log_file: str | None = "logs/geoai_ndvi.log"

    class Config:
        env_file = ".env"


settings = Settings()
settings.cache_dir.mkdir(parents=True, exist_ok=True)

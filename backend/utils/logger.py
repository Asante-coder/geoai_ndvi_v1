"""
Centralised logging configuration using loguru.

Call configure_logging() once at application startup (done in main.py).
All other modules simply import `logger` from loguru directly:

    from loguru import logger
    logger.info("...")
"""

import sys
from pathlib import Path

from loguru import logger


def configure_logging(log_level: str = "INFO", log_file: str | None = None) -> None:
    logger.remove()

    logger.add(
        sys.stderr,
        level=log_level,
        format=(
            "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
            "<level>{level: <8}</level> | "
            "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> — "
            "<level>{message}</level>"
        ),
        colorize=True,
    )

    if log_file:
        log_path = Path(log_file)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        logger.add(
            log_path,
            level=log_level,
            format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} — {message}",
            rotation="10 MB",
            retention="14 days",
            compression="zip",
            enqueue=True,
        )

    logger.info(f"Logging configured — level={log_level}, file={log_file or 'stderr only'}")

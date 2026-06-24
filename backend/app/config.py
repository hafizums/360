from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]

DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024
DEFAULT_MAX_MODEL_BYTES = 100 * 1024 * 1024
DEFAULT_MAX_IMAGE_PIXELS = 50_000_000
DEFAULT_MAX_IMAGE_DIMENSION = 12_000
DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
)


def get_database_path() -> Path:
    configured = os.getenv("SCENE_STAGER_DB_PATH")
    if configured:
        return Path(configured).expanduser().resolve()
    return BASE_DIR / "scene_stager.db"


def get_upload_dir() -> Path:
    configured = os.getenv("SCENE_STAGER_UPLOAD_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    return BASE_DIR / "uploads"


def get_cors_origins() -> list[str]:
    configured = os.getenv("SCENE_STAGER_CORS_ORIGINS")
    if configured:
        return [origin.strip() for origin in configured.split(",") if origin.strip()]
    return list(DEFAULT_CORS_ORIGINS)


def get_max_upload_bytes() -> int:
    value = os.getenv("SCENE_STAGER_MAX_UPLOAD_BYTES")
    if value:
        return int(value)
    return DEFAULT_MAX_UPLOAD_BYTES


def get_max_model_bytes() -> int:
    value = os.getenv("SCENE_STAGER_MAX_MODEL_BYTES")
    if value:
        return int(value)
    return DEFAULT_MAX_MODEL_BYTES


def get_max_image_pixels() -> int:
    value = os.getenv("SCENE_STAGER_MAX_IMAGE_PIXELS")
    if value:
        return int(value)
    return DEFAULT_MAX_IMAGE_PIXELS


def get_max_image_dimension() -> int:
    value = os.getenv("SCENE_STAGER_MAX_IMAGE_DIMENSION")
    if value:
        return int(value)
    return DEFAULT_MAX_IMAGE_DIMENSION

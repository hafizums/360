from __future__ import annotations

from sqlite3 import Row
from typing import Any


def project_from_row(row: Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "source_image_path": row["source_image_path"],
        "panorama_image_path": row["panorama_image_path"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def character_asset_from_row(row: Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "project_id": row["project_id"],
        "name": row["name"],
        "model_path": row["model_path"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def character_instance_from_row(row: Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "project_id": row["project_id"],
        "scene_state_id": row["scene_state_id"],
        "character_asset_id": row["character_asset_id"],
        "name": row["name"],
        "position_x": row["position_x"],
        "position_y": row["position_y"],
        "position_z": row["position_z"],
        "rotation_x": row["rotation_x"],
        "rotation_y": row["rotation_y"],
        "rotation_z": row["rotation_z"],
        "scale": row["scale"],
        "visible": bool(row["visible"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def scene_state_from_row(row: Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "project_id": row["project_id"],
        "name": row["name"],
        "description": row["description"],
        "sort_order": row["sort_order"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }

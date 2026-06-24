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

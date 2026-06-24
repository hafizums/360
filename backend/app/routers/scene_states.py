from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.database import db_session, get_default_scene_state_id
from app.models import character_instance_from_row, scene_state_from_row
from app.schemas import SceneState, SceneStateCreate, SceneStateUpdate

router = APIRouter(prefix="/api/projects/{project_id}/scene-states", tags=["scene-states"])


def ensure_project_exists(project_id: int) -> None:
    with db_session() as conn:
        row = conn.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found")


def get_scene_state_or_404(project_id: int, scene_state_id: int) -> dict:
    with db_session() as conn:
        row = conn.execute(
            """
            SELECT * FROM scene_states
            WHERE id = ? AND project_id = ?
            """,
            (scene_state_id, project_id),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Scene state not found")
    return scene_state_from_row(row)


@router.get("", response_model=list[SceneState])
def list_scene_states(project_id: int) -> list[dict]:
    ensure_project_exists(project_id)
    with db_session() as conn:
        get_default_scene_state_id(conn, project_id)
        rows = conn.execute(
            """
            SELECT * FROM scene_states
            WHERE project_id = ?
            ORDER BY sort_order ASC, id ASC
            """,
            (project_id,),
        ).fetchall()
    return [scene_state_from_row(row) for row in rows]


@router.post("", response_model=SceneState, status_code=201)
def create_scene_state(project_id: int, payload: SceneStateCreate) -> dict:
    ensure_project_exists(project_id)
    with db_session() as conn:
        next_sort_order = conn.execute(
            """
            SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order
            FROM scene_states
            WHERE project_id = ?
            """,
            (project_id,),
        ).fetchone()["next_sort_order"]
        cursor = conn.execute(
            """
            INSERT INTO scene_states (project_id, name, description, sort_order)
            VALUES (?, ?, ?, ?)
            """,
            (project_id, payload.name, payload.description.strip(), next_sort_order),
        )
        row = conn.execute(
            "SELECT * FROM scene_states WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
    return scene_state_from_row(row)


@router.get("/{scene_state_id}", response_model=SceneState)
def get_scene_state(project_id: int, scene_state_id: int) -> dict:
    return get_scene_state_or_404(project_id, scene_state_id)


@router.patch("/{scene_state_id}", response_model=SceneState)
def update_scene_state(
    project_id: int,
    scene_state_id: int,
    payload: SceneStateUpdate,
) -> dict:
    get_scene_state_or_404(project_id, scene_state_id)
    updates = payload.model_dump(exclude_unset=True)
    fields = [field for field in updates if field in {"name", "description", "sort_order"}]

    if fields:
        assignments = []
        values = []
        for field in fields:
            value = updates[field]
            if isinstance(value, str) and field == "description":
                value = value.strip()
            assignments.append(f"{field} = ?")
            values.append(value)
        assignments.append("updated_at = CURRENT_TIMESTAMP")
        values.extend([scene_state_id, project_id])

        with db_session() as conn:
            conn.execute(
                f"""
                UPDATE scene_states
                SET {', '.join(assignments)}
                WHERE id = ? AND project_id = ?
                """,
                values,
            )
            row = conn.execute(
                "SELECT * FROM scene_states WHERE id = ? AND project_id = ?",
                (scene_state_id, project_id),
            ).fetchone()
    else:
        return get_scene_state_or_404(project_id, scene_state_id)

    return scene_state_from_row(row)


@router.delete("/{scene_state_id}")
def delete_scene_state(project_id: int, scene_state_id: int) -> dict[str, bool]:
    get_scene_state_or_404(project_id, scene_state_id)
    with db_session() as conn:
        count = conn.execute(
            "SELECT COUNT(*) AS count FROM scene_states WHERE project_id = ?",
            (project_id,),
        ).fetchone()["count"]
        if count <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last scene state.")
        conn.execute(
            """
            DELETE FROM character_instances
            WHERE project_id = ? AND scene_state_id = ?
            """,
            (project_id, scene_state_id),
        )
        conn.execute(
            "DELETE FROM scene_states WHERE id = ? AND project_id = ?",
            (scene_state_id, project_id),
        )
    return {"deleted": True}


@router.post("/{scene_state_id}/duplicate", response_model=SceneState, status_code=201)
def duplicate_scene_state(project_id: int, scene_state_id: int) -> dict:
    original = get_scene_state_or_404(project_id, scene_state_id)
    with db_session() as conn:
        next_sort_order = conn.execute(
            """
            SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order
            FROM scene_states
            WHERE project_id = ?
            """,
            (project_id,),
        ).fetchone()["next_sort_order"]
        cursor = conn.execute(
            """
            INSERT INTO scene_states (project_id, name, description, sort_order)
            VALUES (?, ?, ?, ?)
            """,
            (
                project_id,
                f"{original['name']} Copy",
                original["description"],
                next_sort_order,
            ),
        )
        new_scene_state_id = cursor.lastrowid
        rows = conn.execute(
            """
            SELECT * FROM character_instances
            WHERE project_id = ? AND scene_state_id = ?
            ORDER BY id ASC
            """,
            (project_id, scene_state_id),
        ).fetchall()
        for row in rows:
            instance = character_instance_from_row(row)
            conn.execute(
                """
                INSERT INTO character_instances (
                    project_id,
                    scene_state_id,
                    character_asset_id,
                    name,
                    position_x,
                    position_y,
                    position_z,
                    rotation_x,
                    rotation_y,
                    rotation_z,
                    scale,
                    visible
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    project_id,
                    new_scene_state_id,
                    instance["character_asset_id"],
                    instance["name"],
                    instance["position_x"],
                    instance["position_y"],
                    instance["position_z"],
                    instance["rotation_x"],
                    instance["rotation_y"],
                    instance["rotation_z"],
                    instance["scale"],
                    1 if instance["visible"] else 0,
                ),
            )
        scene_row = conn.execute(
            "SELECT * FROM scene_states WHERE id = ?",
            (new_scene_state_id,),
        ).fetchone()
    return scene_state_from_row(scene_row)

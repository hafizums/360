from __future__ import annotations

import shutil

from fastapi import APIRouter, HTTPException

from app.config import get_upload_dir
from app.database import db_session, get_default_scene_state_id
from app.models import project_from_row
from app.schemas import Project, ProjectCreate, ProjectUpdate

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("", response_model=list[Project])
def list_projects() -> list[dict]:
    with db_session() as conn:
        rows = conn.execute(
            "SELECT * FROM projects ORDER BY updated_at DESC, id DESC"
        ).fetchall()
    return [project_from_row(row) for row in rows]


@router.post("", response_model=Project, status_code=201)
def create_project(payload: ProjectCreate) -> dict:
    with db_session() as conn:
        cursor = conn.execute(
            "INSERT INTO projects (name, description) VALUES (?, ?)",
            (payload.name, payload.description.strip()),
        )
        get_default_scene_state_id(conn, cursor.lastrowid)
        row = conn.execute(
            "SELECT * FROM projects WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
    return project_from_row(row)


@router.get("/{project_id}", response_model=Project)
def get_project(project_id: int) -> dict:
    with db_session() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project_from_row(row)


def safe_delete_project_upload_folder(project_id: int) -> None:
    upload_root = get_upload_dir().resolve()
    project_dir = (upload_root / f"project_{project_id}").resolve()

    if project_dir.name != f"project_{project_id}":
        return

    try:
        project_dir.relative_to(upload_root)
    except ValueError:
        return

    if project_dir.exists() and project_dir.is_dir():
        shutil.rmtree(project_dir)


@router.patch("/{project_id}", response_model=Project)
def update_project(project_id: int, payload: ProjectUpdate) -> dict:
    updates = payload.model_dump(exclude_unset=True)
    fields = [field for field in updates if field in {"name", "description"}]

    if fields:
        values = []
        assignments = []
        for field in fields:
            value = updates[field]
            if isinstance(value, str) and field == "description":
                value = value.strip()
            assignments.append(f"{field} = ?")
            values.append(value)
        assignments.append("updated_at = CURRENT_TIMESTAMP")
        values.append(project_id)

        with db_session() as conn:
            cursor = conn.execute(
                f"UPDATE projects SET {', '.join(assignments)} WHERE id = ?",
                values,
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Project not found")
            row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    else:
        with db_session() as conn:
            row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Project not found")

    return project_from_row(row)


@router.delete("/{project_id}")
def delete_project(project_id: int) -> dict[str, bool]:
    with db_session() as conn:
        row = conn.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Project not found")
        conn.execute(
            "DELETE FROM character_instances WHERE project_id = ?",
            (project_id,),
        )
        conn.execute(
            "DELETE FROM character_assets WHERE project_id = ?",
            (project_id,),
        )
        conn.execute(
            "DELETE FROM scene_states WHERE project_id = ?",
            (project_id,),
        )
        conn.execute(
            "DELETE FROM environment_variants WHERE project_id = ?",
            (project_id,),
        )
        conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))

    safe_delete_project_upload_folder(project_id)
    return {"deleted": True}

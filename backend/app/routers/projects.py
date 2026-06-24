from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.database import get_connection
from app.models import project_from_row
from app.schemas import Project, ProjectCreate, ProjectUpdate

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("", response_model=list[Project])
def list_projects() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM projects ORDER BY updated_at DESC, id DESC"
        ).fetchall()
    return [project_from_row(row) for row in rows]


@router.post("", response_model=Project, status_code=201)
def create_project(payload: ProjectCreate) -> dict:
    with get_connection() as conn:
        cursor = conn.execute(
            "INSERT INTO projects (name, description) VALUES (?, ?)",
            (payload.name.strip(), payload.description.strip()),
        )
        row = conn.execute(
            "SELECT * FROM projects WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
    return project_from_row(row)


@router.get("/{project_id}", response_model=Project)
def get_project(project_id: int) -> dict:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project_from_row(row)


@router.patch("/{project_id}", response_model=Project)
def update_project(project_id: int, payload: ProjectUpdate) -> dict:
    updates = payload.model_dump(exclude_unset=True)
    allowed_fields = {
        "name",
        "description",
        "source_image_path",
        "panorama_image_path",
    }
    fields = [field for field in updates if field in allowed_fields]

    if fields:
        values = []
        assignments = []
        for field in fields:
            value = updates[field]
            if isinstance(value, str) and field in {"name", "description"}:
                value = value.strip()
            assignments.append(f"{field} = ?")
            values.append(value)
        values.append(project_id)

        with get_connection() as conn:
            cursor = conn.execute(
                f"UPDATE projects SET {', '.join(assignments)} WHERE id = ?",
                values,
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Project not found")
            row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    else:
        with get_connection() as conn:
            row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Project not found")

    return project_from_row(row)

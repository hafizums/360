from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.config import get_max_model_bytes, get_upload_dir
from app.database import db_session
from app.models import character_asset_from_row, character_instance_from_row
from app.routers.uploads import format_upload_size
from app.schemas import (
    CharacterAsset,
    CharacterInstance,
    CharacterInstanceCreate,
    CharacterInstanceUpdate,
)

router = APIRouter(prefix="/api/projects/{project_id}", tags=["characters"])

GLB_EXTENSION = ".glb"
GLB_MAGIC = b"glTF"


def ensure_project_exists(project_id: int) -> None:
    with db_session() as conn:
        row = conn.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found")


def get_asset_or_404(project_id: int, asset_id: int) -> dict:
    with db_session() as conn:
        row = conn.execute(
            """
            SELECT * FROM character_assets
            WHERE id = ? AND project_id = ?
            """,
            (asset_id, project_id),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Character asset not found")
    return character_asset_from_row(row)


def get_instance_or_404(project_id: int, instance_id: int) -> dict:
    with db_session() as conn:
        row = conn.execute(
            """
            SELECT * FROM character_instances
            WHERE id = ? AND project_id = ?
            """,
            (instance_id, project_id),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Character instance not found")
    return character_instance_from_row(row)


def save_glb_model(project_id: int, file: UploadFile) -> Path:
    extension = Path(file.filename or "").suffix.lower()
    if extension != GLB_EXTENSION:
        raise HTTPException(status_code=400, detail="Unsupported model type. Use GLB.")

    project_model_dir = get_upload_dir() / f"project_{project_id}" / "models"
    project_model_dir.mkdir(parents=True, exist_ok=True)
    destination = project_model_dir / f"character_{uuid4().hex}.glb"
    max_model_bytes = get_max_model_bytes()
    bytes_written = 0
    too_large = False

    with destination.open("wb") as buffer:
        while chunk := file.file.read(1024 * 1024):
            bytes_written += len(chunk)
            if bytes_written > max_model_bytes:
                too_large = True
                break
            buffer.write(chunk)

    if too_large:
        destination.unlink(missing_ok=True)
        raise HTTPException(
            status_code=400,
            detail=f"Model upload is too large. Maximum size is {format_upload_size(max_model_bytes)}.",
        )

    with destination.open("rb") as buffer:
        magic = buffer.read(4)

    if magic != GLB_MAGIC:
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail='Uploaded model is not a valid GLB file.')

    return destination


def public_upload_path(path: Path) -> str:
    return "/uploads/" + path.relative_to(get_upload_dir()).as_posix()


def safe_delete_model_file(project_id: int, model_path: str) -> None:
    if not model_path.startswith("/uploads/"):
        return

    upload_dir = get_upload_dir().resolve()
    model_dir = (upload_dir / f"project_{project_id}" / "models").resolve()
    candidate = (upload_dir / model_path.removeprefix("/uploads/")).resolve()

    try:
        candidate.relative_to(model_dir)
    except ValueError:
        return

    candidate.unlink(missing_ok=True)


@router.get("/character-assets", response_model=list[CharacterAsset])
def list_character_assets(project_id: int) -> list[dict]:
    ensure_project_exists(project_id)
    with db_session() as conn:
        rows = conn.execute(
            """
            SELECT * FROM character_assets
            WHERE project_id = ?
            ORDER BY updated_at DESC, id DESC
            """,
            (project_id,),
        ).fetchall()
    return [character_asset_from_row(row) for row in rows]


@router.post("/character-assets/upload", response_model=CharacterAsset, status_code=201)
def upload_character_asset(project_id: int, file: UploadFile = File(...)) -> dict:
    ensure_project_exists(project_id)
    destination = save_glb_model(project_id, file)
    asset_name = Path(file.filename or "Character").stem.strip() or "Character"

    try:
        with db_session() as conn:
            cursor = conn.execute(
                """
                INSERT INTO character_assets (project_id, name, model_path)
                VALUES (?, ?, ?)
                """,
                (project_id, asset_name[:120], public_upload_path(destination)),
            )
            row = conn.execute(
                "SELECT * FROM character_assets WHERE id = ?",
                (cursor.lastrowid,),
            ).fetchone()
    except Exception:
        destination.unlink(missing_ok=True)
        raise

    return character_asset_from_row(row)


@router.delete("/character-assets/{asset_id}")
def delete_character_asset(project_id: int, asset_id: int) -> dict[str, bool]:
    asset = get_asset_or_404(project_id, asset_id)
    with db_session() as conn:
        in_use = conn.execute(
            """
            SELECT COUNT(*) AS count FROM character_instances
            WHERE project_id = ? AND character_asset_id = ?
            """,
            (project_id, asset_id),
        ).fetchone()["count"]
        if in_use:
            raise HTTPException(
                status_code=400,
                detail="Cannot delete a character asset while instances still use it.",
            )
        conn.execute(
            "DELETE FROM character_assets WHERE id = ? AND project_id = ?",
            (asset_id, project_id),
        )
    safe_delete_model_file(project_id, asset["model_path"])
    return {"deleted": True}


@router.get("/character-instances", response_model=list[CharacterInstance])
def list_character_instances(project_id: int) -> list[dict]:
    ensure_project_exists(project_id)
    with db_session() as conn:
        rows = conn.execute(
            """
            SELECT * FROM character_instances
            WHERE project_id = ?
            ORDER BY updated_at DESC, id DESC
            """,
            (project_id,),
        ).fetchall()
    return [character_instance_from_row(row) for row in rows]


@router.post("/character-instances", response_model=CharacterInstance, status_code=201)
def create_character_instance(project_id: int, payload: CharacterInstanceCreate) -> dict:
    asset = get_asset_or_404(project_id, payload.character_asset_id)
    instance_name = payload.name or asset["name"]

    with db_session() as conn:
        cursor = conn.execute(
            """
            INSERT INTO character_instances (project_id, character_asset_id, name)
            VALUES (?, ?, ?)
            """,
            (project_id, payload.character_asset_id, instance_name),
        )
        row = conn.execute(
            "SELECT * FROM character_instances WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
    return character_instance_from_row(row)


@router.patch("/character-instances/{instance_id}", response_model=CharacterInstance)
def update_character_instance(
    project_id: int,
    instance_id: int,
    payload: CharacterInstanceUpdate,
) -> dict:
    get_instance_or_404(project_id, instance_id)
    updates = payload.model_dump(exclude_unset=True)
    fields = [
        field
        for field in updates
        if field
        in {
            "name",
            "position_x",
            "position_y",
            "position_z",
            "rotation_x",
            "rotation_y",
            "rotation_z",
            "scale",
            "visible",
        }
    ]

    if fields:
        values = []
        assignments = []
        for field in fields:
            value = updates[field]
            if field == "visible":
                value = 1 if value else 0
            assignments.append(f"{field} = ?")
            values.append(value)
        assignments.append("updated_at = CURRENT_TIMESTAMP")
        values.extend([instance_id, project_id])

        with db_session() as conn:
            conn.execute(
                f"""
                UPDATE character_instances
                SET {', '.join(assignments)}
                WHERE id = ? AND project_id = ?
                """,
                values,
            )
            row = conn.execute(
                "SELECT * FROM character_instances WHERE id = ? AND project_id = ?",
                (instance_id, project_id),
            ).fetchone()
    else:
        row = get_instance_or_404(project_id, instance_id)
        return row

    return character_instance_from_row(row)


@router.delete("/character-instances/{instance_id}")
def delete_character_instance(project_id: int, instance_id: int) -> dict[str, bool]:
    get_instance_or_404(project_id, instance_id)
    with db_session() as conn:
        conn.execute(
            "DELETE FROM character_instances WHERE id = ? AND project_id = ?",
            (instance_id, project_id),
        )
    return {"deleted": True}


@router.post(
    "/character-instances/{instance_id}/duplicate",
    response_model=CharacterInstance,
    status_code=201,
)
def duplicate_character_instance(project_id: int, instance_id: int) -> dict:
    instance = get_instance_or_404(project_id, instance_id)
    with db_session() as conn:
        cursor = conn.execute(
            """
            INSERT INTO character_instances (
                project_id,
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
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                project_id,
                instance["character_asset_id"],
                f"{instance['name']} Copy",
                instance["position_x"] + 0.5,
                instance["position_y"],
                instance["position_z"],
                instance["rotation_x"],
                instance["rotation_y"],
                instance["rotation_z"],
                instance["scale"],
                1 if instance["visible"] else 0,
            ),
        )
        row = conn.execute(
            "SELECT * FROM character_instances WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
    return character_instance_from_row(row)

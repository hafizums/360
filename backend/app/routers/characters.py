from __future__ import annotations

from pathlib import Path
from struct import unpack
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, Query, UploadFile

from app.config import get_max_model_bytes, get_upload_dir
from app.database import db_session, get_default_scene_state_id
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
GLB_HEADER_BYTES = 12
GLB_VERSION = 2
INVALID_GLB_MESSAGE = "Uploaded model is not a valid GLB file."


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


def get_scene_state_id_or_default(project_id: int, scene_state_id: int | None) -> int:
    with db_session() as conn:
        if scene_state_id is None:
            default_id = get_default_scene_state_id(conn, project_id)
            if default_id is None:
                raise HTTPException(status_code=404, detail="Scene state not found")
            return default_id

        row = conn.execute(
            """
            SELECT id FROM scene_states
            WHERE id = ? AND project_id = ?
            """,
            (scene_state_id, project_id),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Scene state not found")
    return scene_state_id


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

    try:
        validate_glb_file(destination)
    except ValueError:
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=INVALID_GLB_MESSAGE)

    return destination


def validate_glb_file(path: Path) -> None:
    actual_size = path.stat().st_size
    if actual_size < GLB_HEADER_BYTES:
        raise ValueError("GLB file is too short.")

    with path.open("rb") as buffer:
        header = buffer.read(GLB_HEADER_BYTES)

    magic = header[:4]
    version = unpack("<I", header[4:8])[0]
    declared_length = unpack("<I", header[8:12])[0]

    if magic != GLB_MAGIC:
        raise ValueError("GLB magic header is invalid.")
    if version != GLB_VERSION:
        raise ValueError("GLB version is invalid.")
    if declared_length != actual_size:
        raise ValueError("GLB declared length does not match file size.")


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
def list_character_instances(
    project_id: int,
    scene_state_id: int | None = Query(default=None),
) -> list[dict]:
    ensure_project_exists(project_id)
    resolved_scene_state_id = get_scene_state_id_or_default(project_id, scene_state_id)
    with db_session() as conn:
        rows = conn.execute(
            """
            SELECT * FROM character_instances
            WHERE project_id = ? AND scene_state_id = ?
            ORDER BY updated_at DESC, id DESC
            """,
            (project_id, resolved_scene_state_id),
        ).fetchall()
    return [character_instance_from_row(row) for row in rows]


@router.post("/character-instances", response_model=CharacterInstance, status_code=201)
def create_character_instance(project_id: int, payload: CharacterInstanceCreate) -> dict:
    asset = get_asset_or_404(project_id, payload.character_asset_id)
    scene_state_id = get_scene_state_id_or_default(project_id, payload.scene_state_id)
    instance_name = payload.name or asset["name"]

    with db_session() as conn:
        active_environment = conn.execute(
            """
            SELECT floor_y, placement_radius, default_character_scale
            FROM environment_variants
            WHERE project_id = ? AND is_active = 1
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
            """,
            (project_id,),
        ).fetchone()
        position_y = active_environment["floor_y"] if active_environment is not None else 0
        position_z = (
            -active_environment["placement_radius"] if active_environment is not None else -2
        )
        scale = (
            active_environment["default_character_scale"]
            if active_environment is not None
            else 1
        )
        cursor = conn.execute(
            """
            INSERT INTO character_instances (
                project_id,
                scene_state_id,
                character_asset_id,
                name,
                position_y,
                position_z,
                scale
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                project_id,
                scene_state_id,
                payload.character_asset_id,
                instance_name,
                position_y,
                position_z,
                scale,
            ),
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
                instance["scene_state_id"],
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

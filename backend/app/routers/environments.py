from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from PIL import Image

from app.config import get_upload_dir
from app.database import db_session
from app.models import environment_variant_from_row, project_from_row
from app.routers.uploads import public_upload_path, save_upload
from app.schemas import (
    EnvironmentPromptBundle,
    EnvironmentVariant,
    EnvironmentVariantCreate,
    EnvironmentVariantUpdate,
)

router = APIRouter(prefix="/api/projects/{project_id}/environment-variants", tags=["environment-variants"])


def ensure_project_exists(project_id: int) -> dict:
    with db_session() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project_from_row(row)


def get_variant_or_404(project_id: int, variant_id: int) -> dict:
    with db_session() as conn:
        row = conn.execute(
            """
            SELECT * FROM environment_variants
            WHERE id = ? AND project_id = ?
            """,
            (variant_id, project_id),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Environment variant not found")
    return environment_variant_from_row(row)


def list_variant_rows(project_id: int) -> list[dict]:
    ensure_project_exists(project_id)
    with db_session() as conn:
        rows = conn.execute(
            """
            SELECT * FROM environment_variants
            WHERE project_id = ?
            ORDER BY is_active DESC, updated_at DESC, id DESC
            """,
            (project_id,),
        ).fetchall()
    return [environment_variant_from_row(row) for row in rows]


def validate_panorama_file(path: Path) -> None:
    with Image.open(path) as image:
        width, height = image.size

    if height == 0 or abs((width / height) - 2) > 0.01:
        path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=400,
            detail="Panorama must be a 2:1 equirectangular image, such as 4096x2048.",
        )


def safe_delete_variant_upload(project_id: int, path: str | None, variant_id: int) -> None:
    if not path or not path.startswith("/uploads/"):
        return

    with db_session() as conn:
        references = conn.execute(
            """
            SELECT COUNT(*) AS count FROM (
                SELECT source_image_path AS path FROM projects WHERE id = ?
                UNION ALL
                SELECT panorama_image_path AS path FROM projects WHERE id = ?
                UNION ALL
                SELECT source_image_path AS path FROM environment_variants
                WHERE project_id = ? AND id != ?
                UNION ALL
                SELECT panorama_image_path AS path FROM environment_variants
                WHERE project_id = ? AND id != ?
            )
            WHERE path = ?
            """,
            (project_id, project_id, project_id, variant_id, project_id, variant_id, path),
        ).fetchone()["count"]
    if references:
        return

    upload_dir = get_upload_dir().resolve()
    project_dir = (upload_dir / f"project_{project_id}").resolve()
    candidate = (upload_dir / path.removeprefix("/uploads/")).resolve()
    try:
        candidate.relative_to(project_dir)
    except ValueError:
        return
    candidate.unlink(missing_ok=True)


def build_environment_prompts(project: dict, variant: dict) -> dict[str, str]:
    source = variant["source_image_path"] or "No source image uploaded yet."
    notes = variant["notes"] or "No extra environment notes provided."
    target = f"{variant['width']}x{variant['height']}"
    calibration = (
        f"Horizon guide Y: {variant['horizon_y']:.2f}; "
        f"floor Y: {variant['floor_y']:.2f}; "
        f"placement radius: {variant['placement_radius']:.2f}; "
        f"camera height: {variant['camera_height']:.2f}; "
        f"default character scale: {variant['default_character_scale']:.2f}."
    )
    calibration_notes = variant["calibration_notes"] or "No calibration notes provided."
    checklist = "\n".join(
        [
            f"Project: {project['name']}",
            f"Project description: {project['description'] or 'No project description.'}",
            f"Environment variant: {variant['name']}",
            f"Source image: {source}",
            f"User notes: {notes}",
            f"Calibration: {calibration}",
            f"Calibration notes: {calibration_notes}",
            "Checklist:",
            "- Identify the main environment type, layout, materials, lighting direction, color palette, and horizon line.",
            "- Preserve recognizable architectural features and avoid changing the location identity.",
            "- Mark unseen left, right, rear, ceiling, and floor areas that must be plausibly expanded.",
        ]
    )
    panorama_prompt = (
        "Create a seamless 2:1 equirectangular 360 panorama based on the provided source image. "
        "Preserve the main room/environment identity, materials, lighting direction, color palette, "
        "and perspective cues. Expand unseen left, right, rear, ceiling, and floor areas plausibly. "
        f"Output must be {target}, equirectangular, seamless horizontally, with stable horizon line "
        "and no warped furniture. "
        f"Project: {project['name']}. Variant: {variant['name']}. Notes: {notes}. "
        f"Placement calibration to preserve: {calibration} Calibration notes: {calibration_notes}."
    )
    negative_prompt = (
        "No duplicated doors/windows, no distorted perspective, no broken ceiling/floor, "
        "no text/watermarks, no people unless requested, no fisheye frame, no cropped normal photo, "
        "no visible seams."
    )
    manual_instructions = "\n".join(
        [
            "1. Upload a normal source image.",
            "2. Copy the panorama prompt and negative prompt.",
            "3. Generate a 2:1 equirectangular image in an external AI image tool manually.",
            "4. Download the generated result.",
            "5. Upload the result as this panorama variant.",
            "6. Activate the variant.",
            "7. Continue character placement in the 360 editor.",
        ]
    )
    return {
        "source_analysis_checklist": checklist,
        "panorama_prompt": panorama_prompt,
        "negative_prompt": negative_prompt,
        "manual_instructions": manual_instructions,
    }


@router.get("", response_model=list[EnvironmentVariant])
def list_environment_variants(project_id: int) -> list[dict]:
    return list_variant_rows(project_id)


@router.post("", response_model=EnvironmentVariant, status_code=201)
def create_environment_variant(project_id: int, payload: EnvironmentVariantCreate) -> dict:
    ensure_project_exists(project_id)
    with db_session() as conn:
        cursor = conn.execute(
            """
            INSERT INTO environment_variants (
                project_id,
                name,
                notes,
                width,
                height,
                horizon_y,
                floor_y,
                floor_grid_size,
                floor_grid_divisions,
                placement_radius,
                default_character_scale,
                camera_height,
                calibration_notes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                project_id,
                payload.name,
                payload.notes,
                payload.width,
                payload.height,
                payload.horizon_y,
                payload.floor_y,
                payload.floor_grid_size,
                payload.floor_grid_divisions,
                payload.placement_radius,
                payload.default_character_scale,
                payload.camera_height,
                payload.calibration_notes,
            ),
        )
        row = conn.execute(
            "SELECT * FROM environment_variants WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
    return environment_variant_from_row(row)


@router.get("/{variant_id}", response_model=EnvironmentVariant)
def get_environment_variant(project_id: int, variant_id: int) -> dict:
    return get_variant_or_404(project_id, variant_id)


@router.patch("/{variant_id}", response_model=EnvironmentVariant)
def update_environment_variant(
    project_id: int,
    variant_id: int,
    payload: EnvironmentVariantUpdate,
) -> dict:
    get_variant_or_404(project_id, variant_id)
    updates = payload.model_dump(exclude_unset=True)
    fields = [
        field
        for field in updates
        if field
        in {
            "name",
            "status",
            "generator",
            "source_prompt",
            "panorama_prompt",
            "negative_prompt",
            "notes",
            "width",
            "height",
            "horizon_y",
            "floor_y",
            "floor_grid_size",
            "floor_grid_divisions",
            "placement_radius",
            "default_character_scale",
            "camera_height",
            "calibration_notes",
        }
    ]
    if fields:
        assignments = []
        values = []
        for field in fields:
            assignments.append(f"{field} = ?")
            values.append(updates[field])
        assignments.append("updated_at = CURRENT_TIMESTAMP")
        values.extend([variant_id, project_id])
        with db_session() as conn:
            conn.execute(
                f"""
                UPDATE environment_variants
                SET {', '.join(assignments)}
                WHERE id = ? AND project_id = ?
                """,
                values,
            )
            row = conn.execute(
                "SELECT * FROM environment_variants WHERE id = ? AND project_id = ?",
                (variant_id, project_id),
            ).fetchone()
    else:
        return get_variant_or_404(project_id, variant_id)
    return environment_variant_from_row(row)


@router.delete("/{variant_id}")
def delete_environment_variant(project_id: int, variant_id: int) -> dict[str, bool]:
    variant = get_variant_or_404(project_id, variant_id)
    with db_session() as conn:
        if variant["is_active"]:
            conn.execute(
                """
                UPDATE projects
                SET source_image_path = NULL,
                    panorama_image_path = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (project_id,),
            )
        conn.execute(
            "DELETE FROM environment_variants WHERE id = ? AND project_id = ?",
            (variant_id, project_id),
        )
    safe_delete_variant_upload(project_id, variant["source_image_path"], variant_id)
    safe_delete_variant_upload(project_id, variant["panorama_image_path"], variant_id)
    return {"deleted": True}


@router.post("/{variant_id}/activate", response_model=EnvironmentVariant)
def activate_environment_variant(project_id: int, variant_id: int) -> dict:
    variant = get_variant_or_404(project_id, variant_id)
    with db_session() as conn:
        conn.execute(
            "UPDATE environment_variants SET is_active = 0 WHERE project_id = ?",
            (project_id,),
        )
        conn.execute(
            """
            UPDATE environment_variants
            SET is_active = 1,
                status = 'active',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND project_id = ?
            """,
            (variant_id, project_id),
        )
        conn.execute(
            """
            UPDATE projects
            SET source_image_path = ?,
                panorama_image_path = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (variant["source_image_path"], variant["panorama_image_path"], project_id),
        )
        row = conn.execute(
            "SELECT * FROM environment_variants WHERE id = ? AND project_id = ?",
            (variant_id, project_id),
        ).fetchone()
    return environment_variant_from_row(row)


@router.post("/{variant_id}/upload-source", response_model=EnvironmentVariant)
def upload_environment_source(
    project_id: int,
    variant_id: int,
    file: UploadFile = File(...),
) -> dict:
    variant = get_variant_or_404(project_id, variant_id)
    destination = save_upload(project_id, file, f"environment_{variant_id}_source")
    path = public_upload_path(destination)
    with db_session() as conn:
        conn.execute(
            """
            UPDATE environment_variants
            SET source_image_path = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND project_id = ?
            """,
            (path, variant_id, project_id),
        )
        row = conn.execute(
            "SELECT * FROM environment_variants WHERE id = ? AND project_id = ?",
            (variant_id, project_id),
        ).fetchone()
    safe_delete_variant_upload(project_id, variant["source_image_path"], variant_id)
    return environment_variant_from_row(row)


@router.post("/{variant_id}/upload-panorama", response_model=EnvironmentVariant)
def upload_environment_panorama(
    project_id: int,
    variant_id: int,
    file: UploadFile = File(...),
) -> dict:
    variant = get_variant_or_404(project_id, variant_id)
    destination = save_upload(project_id, file, f"environment_{variant_id}_panorama")
    validate_panorama_file(destination)
    path = public_upload_path(destination)
    status = "active" if variant["is_active"] else "panorama_uploaded"
    with db_session() as conn:
        conn.execute(
            """
            UPDATE environment_variants
            SET panorama_image_path = ?,
                status = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND project_id = ?
            """,
            (path, status, variant_id, project_id),
        )
        if variant["is_active"]:
            conn.execute(
                """
                UPDATE projects
                SET panorama_image_path = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (path, project_id),
            )
        row = conn.execute(
            "SELECT * FROM environment_variants WHERE id = ? AND project_id = ?",
            (variant_id, project_id),
        ).fetchone()
    safe_delete_variant_upload(project_id, variant["panorama_image_path"], variant_id)
    return environment_variant_from_row(row)


@router.post("/{variant_id}/generate-prompts", response_model=EnvironmentPromptBundle)
def generate_environment_prompts(project_id: int, variant_id: int) -> dict[str, str]:
    project = ensure_project_exists(project_id)
    variant = get_variant_or_404(project_id, variant_id)
    prompts = build_environment_prompts(project, variant)
    with db_session() as conn:
        conn.execute(
            """
            UPDATE environment_variants
            SET source_prompt = ?,
                panorama_prompt = ?,
                negative_prompt = ?,
                status = 'prompt_ready',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND project_id = ?
            """,
            (
                prompts["source_analysis_checklist"],
                prompts["panorama_prompt"],
                prompts["negative_prompt"],
                variant_id,
                project_id,
            ),
        )
    return prompts

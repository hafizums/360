from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError

from app.config import (
    get_max_image_dimension,
    get_max_image_pixels,
    get_max_upload_bytes,
    get_upload_dir,
)
from app.database import db_session
from app.models import project_from_row
from app.schemas import Project

router = APIRouter(prefix="/api/projects", tags=["uploads"])

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
IMAGE_UPDATE_FIELDS = {"source_image_path", "panorama_image_path"}


def get_project_or_404(project_id: int) -> dict:
    with db_session() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project_from_row(row)


def format_upload_size(size_bytes: int) -> str:
    if size_bytes >= 1024 * 1024:
        return f"{size_bytes // (1024 * 1024)} MB"
    if size_bytes >= 1024:
        return f"{size_bytes // 1024} KB"
    return f"{size_bytes} bytes"


def save_upload(project_id: int, file: UploadFile, kind: str) -> Path:
    extension = Path(file.filename or "").suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Unsupported image type. Use JPG, PNG, or WebP.",
        )

    upload_dir = get_upload_dir()
    project_dir = upload_dir / f"project_{project_id}"
    project_dir.mkdir(parents=True, exist_ok=True)
    destination = project_dir / f"{kind}_{uuid4().hex}{extension}"
    max_upload_bytes = get_max_upload_bytes()
    bytes_written = 0
    too_large = False

    with destination.open("wb") as buffer:
        while chunk := file.file.read(1024 * 1024):
            bytes_written += len(chunk)
            if bytes_written > max_upload_bytes:
                too_large = True
                break
            buffer.write(chunk)

    if too_large:
        destination.unlink(missing_ok=True)
        raise HTTPException(
            status_code=400,
            detail=f"Upload is too large. Maximum size is {format_upload_size(max_upload_bytes)}.",
        )

    try:
        Image.MAX_IMAGE_PIXELS = get_max_image_pixels()
        with Image.open(destination) as image:
            image.verify()
        with Image.open(destination) as image:
            width, height = image.size
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid image.")

    max_dimension = get_max_image_dimension()
    max_pixels = get_max_image_pixels()
    if width <= 0 or height <= 0:
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Uploaded image has invalid dimensions.")
    if width > max_dimension or height > max_dimension or width * height > max_pixels:
        destination.unlink(missing_ok=True)
        raise HTTPException(
            status_code=400,
            detail=(
                "Uploaded image is too large. "
                f"Maximum dimension is {max_dimension}px and maximum area is {max_pixels} pixels."
            ),
        )

    return destination


def public_upload_path(path: Path) -> str:
    return "/uploads/" + path.relative_to(get_upload_dir()).as_posix()


def delete_old_project_upload(project_id: int, old_path: str | None) -> None:
    if not old_path or not old_path.startswith("/uploads/"):
        return

    upload_dir = get_upload_dir().resolve()
    project_dir = (upload_dir / f"project_{project_id}").resolve()
    relative_path = old_path.removeprefix("/uploads/")
    candidate = (upload_dir / relative_path).resolve()

    try:
        candidate.relative_to(project_dir)
    except ValueError:
        return

    candidate.unlink(missing_ok=True)


def update_project_image(project_id: int, field: str, path: str) -> dict:
    if field not in IMAGE_UPDATE_FIELDS:
        raise ValueError("Unsupported image field.")

    with db_session() as conn:
        conn.execute(
            f"UPDATE projects SET {field} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (path, project_id),
        )
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    return project_from_row(row)


@router.post("/{project_id}/upload-source", response_model=Project)
def upload_source_image(project_id: int, file: UploadFile = File(...)) -> dict:
    project = get_project_or_404(project_id)
    destination = save_upload(project_id, file, "source")
    try:
        updated = update_project_image(project_id, "source_image_path", public_upload_path(destination))
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    delete_old_project_upload(project_id, project["source_image_path"])
    return updated


@router.post("/{project_id}/upload-panorama", response_model=Project)
def upload_panorama_image(project_id: int, file: UploadFile = File(...)) -> dict:
    project = get_project_or_404(project_id)
    destination = save_upload(project_id, file, "panorama")

    with Image.open(destination) as image:
        width, height = image.size

    if height == 0 or abs((width / height) - 2) > 0.01:
        destination.unlink(missing_ok=True)
        raise HTTPException(
            status_code=400,
            detail="Panorama must be a 2:1 equirectangular image, such as 4096x2048.",
        )

    try:
        updated = update_project_image(
            project_id,
            "panorama_image_path",
            public_upload_path(destination),
        )
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    delete_old_project_upload(project_id, project["panorama_image_path"])
    return updated

from __future__ import annotations

import shutil
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError

from app.database import BASE_DIR, get_connection
from app.models import project_from_row
from app.schemas import Project

router = APIRouter(prefix="/api/projects", tags=["uploads"])

UPLOAD_DIR = BASE_DIR / "uploads"
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def get_project_or_404(project_id: int) -> dict:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project_from_row(row)


def save_upload(project_id: int, file: UploadFile, kind: str) -> Path:
    extension = Path(file.filename or "").suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Unsupported image type. Use JPG, PNG, or WebP.",
        )

    project_dir = UPLOAD_DIR / f"project_{project_id}"
    project_dir.mkdir(parents=True, exist_ok=True)
    destination = project_dir / f"{kind}_{uuid4().hex}{extension}"

    with destination.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        with Image.open(destination) as image:
            image.verify()
    except (UnidentifiedImageError, OSError):
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid image.")

    return destination


def public_upload_path(path: Path) -> str:
    return "/" + path.relative_to(BASE_DIR).as_posix()


def update_project_image(project_id: int, field: str, path: str) -> dict:
    with get_connection() as conn:
        conn.execute(f"UPDATE projects SET {field} = ? WHERE id = ?", (path, project_id))
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    return project_from_row(row)


@router.post("/{project_id}/upload-source", response_model=Project)
def upload_source_image(project_id: int, file: UploadFile = File(...)) -> dict:
    get_project_or_404(project_id)
    destination = save_upload(project_id, file, "source")
    return update_project_image(project_id, "source_image_path", public_upload_path(destination))


@router.post("/{project_id}/upload-panorama", response_model=Project)
def upload_panorama_image(project_id: int, file: UploadFile = File(...)) -> dict:
    get_project_or_404(project_id)
    destination = save_upload(project_id, file, "panorama")

    with Image.open(destination) as image:
        width, height = image.size

    if height == 0 or abs((width / height) - 2) > 0.01:
        destination.unlink(missing_ok=True)
        raise HTTPException(
            status_code=400,
            detail="Panorama must be a 2:1 equirectangular image, such as 4096x2048.",
        )

    return update_project_image(project_id, "panorama_image_path", public_upload_path(destination))

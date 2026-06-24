from __future__ import annotations

import os
import shutil
import tempfile
from io import BytesIO
from pathlib import Path

os.environ["SCENE_STAGER_TEST_ROOT"] = tempfile.mkdtemp(prefix="scene-stager-tests-")
TEST_ROOT = Path(os.environ["SCENE_STAGER_TEST_ROOT"])
os.environ["SCENE_STAGER_DB_PATH"] = str(TEST_ROOT / "test.db")
os.environ["SCENE_STAGER_UPLOAD_DIR"] = str(TEST_ROOT / "uploads")
os.environ["SCENE_STAGER_MAX_UPLOAD_BYTES"] = str(25 * 1024 * 1024)
os.environ["SCENE_STAGER_MAX_MODEL_BYTES"] = str(100 * 1024 * 1024)
os.environ["SCENE_STAGER_MAX_IMAGE_PIXELS"] = str(50_000_000)
os.environ["SCENE_STAGER_MAX_IMAGE_DIMENSION"] = str(12_000)

from fastapi.testclient import TestClient
from PIL import Image

from app.config import get_database_path, get_upload_dir
from app.database import init_db
from app.main import app


def make_image(width: int = 640, height: int = 480, image_format: str = "PNG") -> BytesIO:
    image = Image.new("RGB", (width, height), "#508f7c")
    buffer = BytesIO()
    image.save(buffer, image_format)
    buffer.seek(0)
    return buffer


def reset_storage() -> None:
    db_path = get_database_path()
    upload_dir = get_upload_dir()
    if db_path.exists():
        db_path.unlink()
    if upload_dir.exists():
        shutil.rmtree(upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    init_db()


def public_path_to_file(path: str) -> Path:
    return get_upload_dir() / path.removeprefix("/uploads/")


def create_project(client: TestClient, name: str = "Studio") -> dict:
    response = client.post(
        "/api/projects",
        json={"name": name, "description": "Test scene"},
    )
    assert response.status_code == 201
    return response.json()


def upload_source(client: TestClient, project_id: int, image: BytesIO | None = None) -> dict:
    response = client.post(
        f"/api/projects/{project_id}/upload-source",
        files={"file": ("source.png", image or make_image(), "image/png")},
    )
    assert response.status_code == 200
    return response.json()


def make_glb(payload: bytes = b"scene-stager") -> BytesIO:
    buffer = BytesIO(b"glTF" + payload)
    buffer.seek(0)
    return buffer


def upload_character_asset(client: TestClient, project_id: int, name: str = "hero.glb") -> dict:
    response = client.post(
        f"/api/projects/{project_id}/character-assets/upload",
        files={"file": (name, make_glb(), "model/gltf-binary")},
    )
    assert response.status_code == 201
    return response.json()


def create_character_instance(client: TestClient, project_id: int, asset_id: int) -> dict:
    response = client.post(
        f"/api/projects/{project_id}/character-instances",
        json={"character_asset_id": asset_id},
    )
    assert response.status_code == 201
    return response.json()


def test_create_project_success() -> None:
    reset_storage()
    with TestClient(app) as client:
        response = client.post(
            "/api/projects",
            json={"name": "  Apartment Concept  ", "description": "  Notes  "},
        )

    assert response.status_code == 201
    payload = response.json()
    assert payload["name"] == "Apartment Concept"
    assert payload["description"] == "Notes"
    assert payload["source_image_path"] is None
    assert payload["panorama_image_path"] is None


def test_whitespace_only_project_name_rejected() -> None:
    reset_storage()
    with TestClient(app) as client:
        create_response = client.post(
            "/api/projects",
            json={"name": "   ", "description": ""},
        )
        project = create_project(client)
        update_response = client.patch(
            f"/api/projects/{project['id']}",
            json={"name": "\t  "},
        )

    assert create_response.status_code == 422
    assert "Project name is required" in create_response.text
    assert update_response.status_code == 422
    assert "Project name is required" in update_response.text


def test_list_projects() -> None:
    reset_storage()
    with TestClient(app) as client:
        first = create_project(client, "First")
        second = create_project(client, "Second")
        response = client.get("/api/projects")

    assert response.status_code == 200
    ids = [project["id"] for project in response.json()]
    assert second["id"] in ids
    assert first["id"] in ids


def test_get_project() -> None:
    reset_storage()
    with TestClient(app) as client:
        project = create_project(client, "Get Me")
        response = client.get(f"/api/projects/{project['id']}")

    assert response.status_code == 200
    assert response.json()["name"] == "Get Me"


def test_update_project_name_description() -> None:
    reset_storage()
    with TestClient(app) as client:
        project = create_project(client)
        response = client.patch(
            f"/api/projects/{project['id']}",
            json={"name": "  Updated Name  ", "description": "  Updated notes  "},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "Updated Name"
    assert payload["description"] == "Updated notes"


def test_patch_cannot_set_image_paths() -> None:
    reset_storage()
    with TestClient(app) as client:
        project = create_project(client)
        response = client.patch(
            f"/api/projects/{project['id']}",
            json={
                "source_image_path": "/uploads/project_1/source.png",
                "panorama_image_path": "/uploads/project_1/panorama.png",
            },
        )

    assert response.status_code == 422
    assert "Extra inputs are not permitted" in response.text


def test_upload_valid_source_image() -> None:
    reset_storage()
    with TestClient(app) as client:
        project = create_project(client)
        response = client.post(
            f"/api/projects/{project['id']}/upload-source",
            files={"file": ("source.png", make_image(), "image/png")},
        )

    assert response.status_code == 200
    path = response.json()["source_image_path"]
    assert path.startswith(f"/uploads/project_{project['id']}/source_")
    assert public_path_to_file(path).exists()


def test_reject_invalid_extension() -> None:
    reset_storage()
    with TestClient(app) as client:
        project = create_project(client)
        response = client.post(
            f"/api/projects/{project['id']}/upload-source",
            files={"file": ("source.gif", make_image(), "image/gif")},
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "Unsupported image type. Use JPG, PNG, or WebP."


def test_reject_fake_image() -> None:
    reset_storage()
    with TestClient(app) as client:
        project = create_project(client)
        response = client.post(
            f"/api/projects/{project['id']}/upload-source",
            files={"file": ("source.png", BytesIO(b"not an image"), "image/png")},
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "Uploaded file is not a valid image."


def test_reject_oversized_upload() -> None:
    reset_storage()
    original_limit = os.environ["SCENE_STAGER_MAX_UPLOAD_BYTES"]
    os.environ["SCENE_STAGER_MAX_UPLOAD_BYTES"] = "64"
    try:
        with TestClient(app) as client:
            project = create_project(client)
            response = client.post(
                f"/api/projects/{project['id']}/upload-source",
                files={"file": ("source.png", make_image(), "image/png")},
            )
    finally:
        os.environ["SCENE_STAGER_MAX_UPLOAD_BYTES"] = original_limit

    assert response.status_code == 400
    assert response.json()["detail"] == "Upload is too large. Maximum size is 64 bytes."


def test_reject_image_over_dimension_limit() -> None:
    reset_storage()
    original_limit = os.environ["SCENE_STAGER_MAX_IMAGE_DIMENSION"]
    os.environ["SCENE_STAGER_MAX_IMAGE_DIMENSION"] = "100"
    try:
        with TestClient(app) as client:
            project = create_project(client)
            response = client.post(
                f"/api/projects/{project['id']}/upload-source",
                files={"file": ("source.png", make_image(200, 100), "image/png")},
            )
    finally:
        os.environ["SCENE_STAGER_MAX_IMAGE_DIMENSION"] = original_limit

    assert response.status_code == 400
    assert "Uploaded image is too large" in response.json()["detail"]


def test_upload_valid_2_to_1_panorama() -> None:
    reset_storage()
    with TestClient(app) as client:
        project = create_project(client)
        response = client.post(
            f"/api/projects/{project['id']}/upload-panorama",
            files={"file": ("panorama.png", make_image(2048, 1024), "image/png")},
        )

    assert response.status_code == 200
    path = response.json()["panorama_image_path"]
    assert path.startswith(f"/uploads/project_{project['id']}/panorama_")
    assert public_path_to_file(path).exists()


def test_reject_non_2_to_1_panorama() -> None:
    reset_storage()
    with TestClient(app) as client:
        project = create_project(client)
        response = client.post(
            f"/api/projects/{project['id']}/upload-panorama",
            files={"file": ("panorama.png", make_image(1200, 900), "image/png")},
        )

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Panorama must be a 2:1 equirectangular image, such as 4096x2048."
    )


def test_replacing_source_image_removes_previous_uploaded_source_file() -> None:
    reset_storage()
    with TestClient(app) as client:
        project = create_project(client)
        first = upload_source(client, project["id"], make_image(640, 480))
        first_file = public_path_to_file(first["source_image_path"])
        assert first_file.exists()

        second = upload_source(client, project["id"], make_image(800, 600))
        second_file = public_path_to_file(second["source_image_path"])

    assert not first_file.exists()
    assert second_file.exists()
    assert first["source_image_path"] != second["source_image_path"]


def test_upload_valid_glb_asset() -> None:
    reset_storage()
    with TestClient(app) as client:
        project = create_project(client)
        response = client.post(
            f"/api/projects/{project['id']}/character-assets/upload",
            files={"file": ("hero.glb", make_glb(), "model/gltf-binary")},
        )

    assert response.status_code == 201
    payload = response.json()
    assert payload["name"] == "hero"
    assert payload["model_path"].startswith(f"/uploads/project_{project['id']}/models/")
    assert public_path_to_file(payload["model_path"]).exists()


def test_reject_non_glb_extension() -> None:
    reset_storage()
    with TestClient(app) as client:
        project = create_project(client)
        response = client.post(
            f"/api/projects/{project['id']}/character-assets/upload",
            files={"file": ("hero.obj", make_glb(), "text/plain")},
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "Unsupported model type. Use GLB."


def test_reject_fake_glb_magic_header() -> None:
    reset_storage()
    with TestClient(app) as client:
        project = create_project(client)
        response = client.post(
            f"/api/projects/{project['id']}/character-assets/upload",
            files={"file": ("hero.glb", BytesIO(b"nope"), "model/gltf-binary")},
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "Uploaded model is not a valid GLB file."


def test_list_character_assets() -> None:
    reset_storage()
    with TestClient(app) as client:
        project = create_project(client)
        asset = upload_character_asset(client, project["id"])
        response = client.get(f"/api/projects/{project['id']}/character-assets")

    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [asset["id"]]


def test_create_character_instance() -> None:
    reset_storage()
    with TestClient(app) as client:
        project = create_project(client)
        asset = upload_character_asset(client, project["id"])
        response = client.post(
            f"/api/projects/{project['id']}/character-instances",
            json={"character_asset_id": asset["id"]},
        )

    assert response.status_code == 201
    payload = response.json()
    assert payload["character_asset_id"] == asset["id"]
    assert payload["position_x"] == 0
    assert payload["position_y"] == 0
    assert payload["position_z"] == -2
    assert payload["scale"] == 1
    assert payload["visible"] is True


def test_update_character_instance_transform() -> None:
    reset_storage()
    with TestClient(app) as client:
        project = create_project(client)
        asset = upload_character_asset(client, project["id"])
        instance = create_character_instance(client, project["id"], asset["id"])
        response = client.patch(
            f"/api/projects/{project['id']}/character-instances/{instance['id']}",
            json={
                "name": "Hero A",
                "position_x": 1.25,
                "position_y": 0.5,
                "position_z": -3.5,
                "rotation_x": 0.1,
                "rotation_y": 0.2,
                "rotation_z": 0.3,
                "scale": 1.4,
                "visible": False,
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "Hero A"
    assert payload["position_x"] == 1.25
    assert payload["position_y"] == 0.5
    assert payload["position_z"] == -3.5
    assert payload["rotation_x"] == 0.1
    assert payload["rotation_y"] == 0.2
    assert payload["rotation_z"] == 0.3
    assert payload["scale"] == 1.4
    assert payload["visible"] is False


def test_duplicate_character_instance() -> None:
    reset_storage()
    with TestClient(app) as client:
        project = create_project(client)
        asset = upload_character_asset(client, project["id"])
        instance = create_character_instance(client, project["id"], asset["id"])
        response = client.post(
            f"/api/projects/{project['id']}/character-instances/{instance['id']}/duplicate",
        )

    assert response.status_code == 201
    duplicate = response.json()
    assert duplicate["id"] != instance["id"]
    assert duplicate["character_asset_id"] == instance["character_asset_id"]
    assert duplicate["position_x"] == instance["position_x"] + 0.5


def test_delete_character_instance() -> None:
    reset_storage()
    with TestClient(app) as client:
        project = create_project(client)
        asset = upload_character_asset(client, project["id"])
        instance = create_character_instance(client, project["id"], asset["id"])
        delete_response = client.delete(
            f"/api/projects/{project['id']}/character-instances/{instance['id']}",
        )
        list_response = client.get(f"/api/projects/{project['id']}/character-instances")

    assert delete_response.status_code == 200
    assert list_response.status_code == 200
    assert list_response.json() == []


def test_block_deleting_asset_while_in_use() -> None:
    reset_storage()
    with TestClient(app) as client:
        project = create_project(client)
        asset = upload_character_asset(client, project["id"])
        create_character_instance(client, project["id"], asset["id"])
        response = client.delete(
            f"/api/projects/{project['id']}/character-assets/{asset['id']}",
        )

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Cannot delete a character asset while instances still use it."
    )
    assert public_path_to_file(asset["model_path"]).exists()


def test_delete_unused_asset_removes_model_file_safely() -> None:
    reset_storage()
    with TestClient(app) as client:
        project = create_project(client)
        asset = upload_character_asset(client, project["id"])
        model_file = public_path_to_file(asset["model_path"])
        assert model_file.exists()

        response = client.delete(
            f"/api/projects/{project['id']}/character-assets/{asset['id']}",
        )
        list_response = client.get(f"/api/projects/{project['id']}/character-assets")

    assert response.status_code == 200
    assert list_response.json() == []
    assert not model_file.exists()

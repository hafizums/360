# 360 Scene Stager

Personal-use local web app for collecting room references, viewing uploaded 360 equirectangular panoramas, and placing uploaded GLB character models in a simple 3D editor.

This app intentionally supports manual uploads only. It does not generate panoramas, call AI providers, or use paid APIs.

## Stack

- Frontend: Vite, React, TypeScript
- 3D viewer: Three.js, React Three Fiber, Drei
- Backend: FastAPI
- Database: SQLite
- File storage: local `backend/uploads`

## Project Structure

```text
backend/
  app/
    main.py
    database.py
    models.py
    schemas.py
    routers/
      characters.py
      projects.py
      uploads.py
  uploads/
  requirements.txt

frontend/
  src/
    App.tsx
    api.ts
    pages/
      ProjectList.tsx
      ProjectEditor.tsx
    components/
      PanoramaViewer.tsx
      UploadPanel.tsx
  package.json
```

## Backend Setup

From the repository root:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The API will be available at `http://127.0.0.1:8000`.

SQLite data is stored in `backend/scene_stager.db`.

Uploaded files are stored under `backend/uploads/project_<id>/` and are served from `http://127.0.0.1:8000/uploads/...`.

Uploads are local-only and limited by default to 25 MB per file. Supported image extensions are `jpg`, `jpeg`, `png`, and `webp`. Images are validated with Pillow, and panoramas must be 2:1 equirectangular images. Very large images are rejected before they can exhaust memory; by default, images are limited to 12,000 pixels on either side and 50,000,000 total pixels.

Character model uploads are GLB-only and limited by default to 100 MB per file. GLB files are stored under `backend/uploads/project_<id>/models/` and validated by extension plus the binary GLB magic header.

You can override upload limits for local development or tests with environment variables:

```powershell
$env:SCENE_STAGER_MAX_UPLOAD_BYTES="26214400"
$env:SCENE_STAGER_MAX_MODEL_BYTES="104857600"
$env:SCENE_STAGER_MAX_IMAGE_DIMENSION="12000"
$env:SCENE_STAGER_MAX_IMAGE_PIXELS="50000000"
```

## Frontend Setup

Open a second terminal from the repository root:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://127.0.0.1:5173` in your browser.

If your backend runs somewhere else, create `frontend/.env`:

```text
VITE_API_URL=http://127.0.0.1:8000
```

## Manual Workflow

1. Open `http://127.0.0.1:5173`.
2. Create a project with a name and optional description.
3. In the editor sidebar, upload a normal source reference image.
4. Upload a panorama image using the 360 panorama panel.
5. The panorama must be a 2:1 equirectangular image, such as `4096x2048` or `2048x1024`.
6. Upload a `.glb` character model in the Character assets panel.
7. Click `Add` next to the character asset to place it in the scene.
8. Select the placed character in the Objects panel or in the 3D viewer.
9. Use Move, Rotate, and Scale modes to edit the selected character with TransformControls.
10. Use the inspector to fine tune name, position, rotation, scale, and visibility, then save.
11. Duplicate an instance to create another placement of the same asset.
12. Refresh the browser and confirm the placements remain.
13. Delete one instance and confirm other placements remain.

Refreshing the browser keeps project metadata, uploaded image paths, character assets, and character placements because they are stored in SQLite.

## Coordinate Convention

- `y` is up.
- The floor grid is at `y = 0`.
- New character instances start at `x = 0`, `y = 0`, `z = -2`.
- Rotation is stored in radians. The inspector shows rotation in degrees for editing.
- Scale is stored as one uniform scalar.

## API Endpoints

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/{project_id}`
- `PATCH /api/projects/{project_id}`
- `POST /api/projects/{project_id}/upload-source`
- `POST /api/projects/{project_id}/upload-panorama`
- `GET /api/projects/{project_id}/character-assets`
- `POST /api/projects/{project_id}/character-assets/upload`
- `DELETE /api/projects/{project_id}/character-assets/{asset_id}`
- `GET /api/projects/{project_id}/character-instances`
- `POST /api/projects/{project_id}/character-instances`
- `PATCH /api/projects/{project_id}/character-instances/{instance_id}`
- `DELETE /api/projects/{project_id}/character-instances/{instance_id}`
- `POST /api/projects/{project_id}/character-instances/{instance_id}/duplicate`

`PATCH /api/projects/{project_id}` only updates project metadata: `name` and `description`. Direct editing of `source_image_path` and `panorama_image_path` is intentionally blocked so uploaded files remain managed by the upload endpoints, including validation and old-file cleanup.

Deleting a character asset is blocked while any character instances still use it. Deleting an unused asset removes its GLB file only when that file is safely inside the current project's `models` upload folder.

## Tests

Backend:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
pytest
python -m compileall app
```

Frontend:

```powershell
cd frontend
npm run build
```

## Future Module Boundaries

The current app keeps project metadata and upload workflows separate from the viewer component so later modules can be added without replacing the foundation:

- Scene states
- Shot planner
- Prompt export
- Provider adapters

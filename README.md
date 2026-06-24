# 360 Scene Stager

Personal-use local web app for collecting room references, viewing uploaded 360 equirectangular panoramas, placing uploaded GLB character models, and saving multiple scene states for shot planning.

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
      scene_states.py
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
7. Add the character to `Base Scene`.
8. Create a new Scene State or duplicate `Base Scene` to make the next shot.
9. Move the character differently in the new state.
10. Switch between scene states and confirm the object list and viewer placements change.
11. Refresh the browser and confirm scene states and placements persist.
12. Delete one scene state and confirm character asset files remain.

## Scene States / Shot States

Each project always has at least one scene state named `Base Scene`. A scene state stores its own character placements, including position, rotation, scale, visibility, and instance names.

Use scene states for shot or beat variations:

- Shot 1: character standing near the sofa.
- Shot 2: the same character moved near the table.
- Shot 3: two characters visible in different positions.
- Shot 4: one character hidden while another remains visible.

Duplicating a scene state copies all character placements into a new state named `{original name} Copy`. This is the fastest way to create the next shot while preserving the previous arrangement.

Deleting a scene state deletes only the character instances in that state. It does not delete character assets or GLB model files. Deleting the last scene state is blocked.

## Character Placement

1. Upload a `.glb` character model.
2. Click `Add` next to the character asset to place it in the selected scene state.
3. Select the placed character in the Objects panel or in the 3D viewer.
4. Use Move, Rotate, and Scale modes to edit the selected character with TransformControls.
5. Use the inspector to fine tune name, position, rotation, scale, and visibility, then save.
6. Duplicate an instance to create another placement of the same asset.
7. Refresh the browser and confirm the placements remain.
8. Delete one instance and confirm other placements remain.

Refreshing the browser keeps project metadata, uploaded image paths, character assets, scene states, and character placements because they are stored in SQLite.

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
- `GET /api/projects/{project_id}/scene-states`
- `POST /api/projects/{project_id}/scene-states`
- `GET /api/projects/{project_id}/scene-states/{scene_state_id}`
- `PATCH /api/projects/{project_id}/scene-states/{scene_state_id}`
- `DELETE /api/projects/{project_id}/scene-states/{scene_state_id}`
- `POST /api/projects/{project_id}/scene-states/{scene_state_id}/duplicate`
- `GET /api/projects/{project_id}/character-assets`
- `POST /api/projects/{project_id}/character-assets/upload`
- `DELETE /api/projects/{project_id}/character-assets/{asset_id}`
- `GET /api/projects/{project_id}/character-instances`
- `POST /api/projects/{project_id}/character-instances`
- `PATCH /api/projects/{project_id}/character-instances/{instance_id}`
- `DELETE /api/projects/{project_id}/character-instances/{instance_id}`
- `POST /api/projects/{project_id}/character-instances/{instance_id}/duplicate`

`PATCH /api/projects/{project_id}` only updates project metadata: `name` and `description`. Direct editing of `source_image_path` and `panorama_image_path` is intentionally blocked so uploaded files remain managed by the upload endpoints, including validation and old-file cleanup.

`GET /api/projects/{project_id}/character-instances` accepts an optional `scene_state_id` query parameter. If omitted, the backend uses the project's first/default scene state. Creating an instance also accepts optional `scene_state_id`.

Deleting a character asset is blocked while any character instances in any scene state still use it. Deleting an unused asset removes its GLB file only when that file is safely inside the current project's `models` upload folder.

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

- Shot planner
- Prompt export
- Provider adapters

# 360 Scene Stager

Personal-use local web app for collecting room references and viewing uploaded 360 equirectangular panoramas in a simple 3D editor.

This milestone intentionally supports manual uploads only. It does not generate panoramas, place characters, call AI providers, or use paid APIs.

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
6. Use the mouse to orbit around the panorama.
7. Use the reset camera button to return the viewer to its initial orientation.

Refreshing the browser keeps project metadata and uploaded image paths because they are stored in SQLite.

## API Endpoints

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/{project_id}`
- `PATCH /api/projects/{project_id}`
- `POST /api/projects/{project_id}/upload-source`
- `POST /api/projects/{project_id}/upload-panorama`

## Future Module Boundaries

The current app keeps project metadata and upload workflows separate from the viewer component so later modules can be added without replacing the foundation:

- Character placement
- Scene states
- Shot planner
- Prompt export
- Provider adapters

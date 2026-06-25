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
      environments.py
      exports.py
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

## Environment Builder

Environment Builder manages manual source-to-360 panorama variants for each project. It does not generate images, call AI providers, or use paid APIs. It helps you prepare prompts, track generated panorama variants, upload the finished 2:1 panorama manually, and activate the variant for the existing 360 viewer.

A normal image cannot be exactly converted into a full 360 panorama without inventing unseen areas. Left, right, rear, ceiling, and floor regions are not present in the source photo, so any external generation tool must plausibly expand or hallucinate those areas. Environment Builder keeps that process explicit and local.

Workflow:

1. Create an environment variant.
2. Upload a normal source image.
3. Add notes and choose a target size.
4. Generate deterministic local prompts.
5. Copy the panorama prompt and negative prompt into an external image tool manually.
6. Generate and download a 2:1 equirectangular panorama outside this app.
7. Upload the generated panorama to the variant.
8. Activate the variant.
9. Continue shot planning and character placement.

Use `2048x1024` for fast tests and `4096x2048` for better-quality working panoramas. Activating a variant updates the project source/panorama paths so the existing viewer uses the active panorama while scene states and character placements remain unchanged.

Environment variants also store floor and horizon calibration:

- Horizon guide Y, shown as an overlay line in the panorama viewer.
- Floor Y, grid size, and grid divisions for the 3D floor guide.
- Placement radius for the default character blocking circle.
- Default character scale.
- Camera height for eye-level camera presets.
- Calibration notes for exports and prompt context.

New character instances use the active environment calibration. If no active environment exists, the app falls back to the original defaults.

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

Character model uploads are GLB-only and limited by default to 100 MB per file. GLB files are stored under `backend/uploads/project_<id>/models/` and validated by extension plus the binary GLB header: magic `glTF`, version `2`, minimum 12-byte header, and declared total length matching the uploaded file size.

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
3. In Setup, optionally rename the project or edit its description.
4. Open Environment Builder and create an environment variant.
5. Upload a normal source image to the variant.
6. Generate and copy the local panorama prompt.
7. Generate a 2:1 equirectangular panorama externally and upload it to the variant.
8. Activate the variant.
9. The panorama must be a 2:1 equirectangular image, such as `4096x2048` or `2048x1024`.
10. Upload a `.glb` character model in the Character assets panel.
11. Add the character to `Base Scene`.
12. Calibrate the environment floor, horizon, placement radius, default character scale, and camera height if needed.
13. Use Reset transform, Calibrated reset, Drop to floor, Placement radius, Default scale, Focus selected, Hide guides, and the transform fields as needed.
14. Adjust the camera view or use Eye-level, Top-down, and Face selected, then click `Save camera`.
15. Fill shot number, shot size, camera move, action notes, and prompt notes. Scene metadata autosaves after a short debounce; the manual Save state button remains available.
16. Download a clean screenshot and scene JSON for the selected state.
17. Copy the image and video prompts from Prompt export.
18. Duplicate or create scene states for new shots, then use Up/Down to reorder them.
19. Move the character differently in another state and save its camera.
20. Switch between scene states and confirm camera, object list, and viewer placements change.
21. Download the project package ZIP.
22. Refresh the browser and confirm environment variants, calibration, scene states, shot metadata, camera framing, ordering, and placements persist.
23. Use Delete project only when you want to remove the project metadata and its local `uploads/project_<id>/` folder.

## Scene States / Shot States

Each project always has at least one scene state named `Base Scene`. A scene state stores its own character placements, including position, rotation, scale, visibility, and instance names.

Scene states also store shot planner metadata:

- Shot number.
- Shot size: `WIDE`, `MS`, `CU`, or `ECU`.
- Camera move: `static`, `push`, `pull`, `pan`, `tilt`, `handheld`, `orbit`, `dolly`, or `zoom`.
- Action notes and prompt notes.
- Saved camera position, OrbitControls target, and field of view.

Use scene states for shot or beat variations:

- Shot 1: character standing near the sofa.
- Shot 2: the same character moved near the table.
- Shot 3: two characters visible in different positions.
- Shot 4: one character hidden while another remains visible.

Duplicating a scene state copies all character placements into a new state named `{original name} Copy`. This is the fastest way to create the next shot while preserving the previous arrangement.

Scene metadata autosaves after about 800 ms once fields change. The status badge shows Unsaved, Saving, Saved, or Error. When switching scene states, pending metadata, transform, and camera changes are saved before the next state loads.

Use the scene list Up and Down buttons to change `scene_state.sort_order`. Ordering is saved through the backend and restored after refresh.

Deleting a scene state deletes only the character instances in that state. It does not delete character assets or GLB model files. Deleting the last scene state is blocked.

Deleting a project removes project metadata and related scene, character asset, and character instance rows. It also deletes only the local `backend/uploads/project_<id>/` folder after safety checks. Files outside that exact project upload folder are not deleted.

## Camera Save / Restore

The panorama viewer exposes the current camera position, OrbitControls target, and FOV to the editor. Click `Save camera` in the Scene States panel to store the current framing on the selected scene state.

Switching scene states restores that state's saved camera framing. `Reset camera` reloads the currently selected scene state's saved camera values.

Use `Zoom / FOV` to adjust camera zoom numerically. Lower FOV zooms in; higher FOV widens the view. `Eye-level` uses the active environment camera height and placement radius, `Top-down` uses the calibrated floor, and `Face selected` frames the selected character. Each preset can be saved like any other camera framing.

## Exports

Screenshot export is browser-local. Click `Download screenshot` to save the current viewer canvas as `project-{projectId}-shot-{shotNumber}-scene-{sceneStateId}.png`.

Clean export is enabled by default in the Export panel. When enabled, calibration guides, grid, and transform controls are temporarily hidden for the screenshot, then restored in the editor afterward.

Scene JSON export is served by `GET /api/projects/{project_id}/scene-states/{scene_state_id}/export-json`. It downloads as `project-{projectId}-shot-{shotNumber}-scene-{sceneStateId}.json` and includes project metadata, panorama/source paths, environment variants, active environment calibration, selected scene state metadata, saved camera metadata, character assets used by the scene, character instances, coordinate convention, prompts, and a `generated_at` timestamp.

Prompt export is deterministic and local. It includes shot number, shot size, camera move, scene description, action notes, prompt notes, and character placement. It does not call an LLM or provider. The panel provides copy buttons for:

- Image reference prompt.
- Video prompt.
- Negative / consistency prompt.
- Character placement summary.

Project package export is served by `GET /api/projects/{project_id}/export-package`. It returns a ZIP containing `project.json`, `environment_variants.json`, `environment_calibration.json`, `scene_states.json`, `character_assets.json`, `character_instances.json`, and `prompts.txt`. Large uploaded image and model binaries are not included yet; the package stores their local/public paths.

Scene JSON export includes all environment variants and the active environment variant for the selected project. Prompt export includes an environment calibration summary so later provider adapters can preserve floor, scale, and camera-height assumptions.

## Character Placement

1. Upload a `.glb` character model.
2. Click `Add` next to the character asset to place it in the selected scene state.
3. Select the placed character in the Objects panel or in the 3D viewer.
4. Use Move, Rotate, and Scale modes to edit the selected character with TransformControls.
5. Use the inspector to fine tune name, position, rotation, scale, and visibility, then save.
6. Use Reset transform to return the selected instance to the original app defaults: `x=0`, `y=0`, `z=-2`, rotation `0,0,0`, scale `1`.
7. Use Calibrated reset to place the selected instance at the active environment floor, negative placement radius, zero rotation, and default character scale.
8. Use Drop to floor, Placement radius, and Default scale for targeted calibration fixes.
9. Use Focus selected to aim the camera target at the selected character without changing the character transform.
10. Use Hide guides to hide transform controls and the calibration grid while keeping objects selectable from the object list.
11. Duplicate an instance to create another placement of the same asset.
12. Refresh the browser and confirm the placements remain.
13. Delete one instance and confirm other placements remain.

Refreshing the browser keeps project metadata, uploaded image paths, character assets, scene states, and character placements because they are stored in SQLite.

## Coordinate Convention

- `y` is up.
- The calibrated floor grid defaults to `y = 0`.
- New character instances use the active environment floor Y, negative placement radius, and default character scale.
- If no active environment calibration exists, new character instances start at `x = 0`, `y = 0`, `z = -2`, scale `1`.
- Rotation is stored in radians. The inspector shows rotation in degrees for editing.
- Scale is stored as one uniform scalar.

## API Endpoints

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/{project_id}`
- `PATCH /api/projects/{project_id}`
- `DELETE /api/projects/{project_id}`
- `POST /api/projects/{project_id}/upload-source`
- `POST /api/projects/{project_id}/upload-panorama`
- `GET /api/projects/{project_id}/environment-variants`
- `POST /api/projects/{project_id}/environment-variants`
- `GET /api/projects/{project_id}/environment-variants/{variant_id}`
- `PATCH /api/projects/{project_id}/environment-variants/{variant_id}`
- `DELETE /api/projects/{project_id}/environment-variants/{variant_id}`
- `POST /api/projects/{project_id}/environment-variants/{variant_id}/activate`
- `POST /api/projects/{project_id}/environment-variants/{variant_id}/upload-source`
- `POST /api/projects/{project_id}/environment-variants/{variant_id}/upload-panorama`
- `POST /api/projects/{project_id}/environment-variants/{variant_id}/generate-prompts`
- `GET /api/projects/{project_id}/scene-states`
- `POST /api/projects/{project_id}/scene-states`
- `GET /api/projects/{project_id}/scene-states/{scene_state_id}`
- `PATCH /api/projects/{project_id}/scene-states/{scene_state_id}`
- `DELETE /api/projects/{project_id}/scene-states/{scene_state_id}`
- `POST /api/projects/{project_id}/scene-states/{scene_state_id}/duplicate`
- `GET /api/projects/{project_id}/scene-states/{scene_state_id}/export-json`
- `GET /api/projects/{project_id}/export-package`
- `GET /api/projects/{project_id}/character-assets`
- `POST /api/projects/{project_id}/character-assets/upload`
- `DELETE /api/projects/{project_id}/character-assets/{asset_id}`
- `GET /api/projects/{project_id}/character-instances`
- `POST /api/projects/{project_id}/character-instances`
- `PATCH /api/projects/{project_id}/character-instances/{instance_id}`
- `DELETE /api/projects/{project_id}/character-instances/{instance_id}`
- `POST /api/projects/{project_id}/character-instances/{instance_id}/duplicate`

`PATCH /api/projects/{project_id}` only updates project metadata: `name` and `description`. Direct editing of `source_image_path` and `panorama_image_path` is intentionally blocked so uploaded files remain managed by the upload endpoints, including validation and old-file cleanup.

`DELETE /api/projects/{project_id}` deletes project metadata and related database rows, then safely deletes only `backend/uploads/project_<id>/` if it is inside the configured upload root.

`GET /api/projects/{project_id}/character-instances` accepts an optional `scene_state_id` query parameter. If omitted, the backend uses the project's first/default scene state. Creating an instance also accepts optional `scene_state_id`.

`PATCH /api/projects/{project_id}/environment-variants/{variant_id}` stores environment metadata and calibration. Upload paths are intentionally not patchable; source and panorama paths can only change through the upload endpoints.

Deleting a character asset is blocked while any character instances in any scene state still use it. Deleting an unused asset removes its GLB file only when that file is safely inside the current project's `models` upload folder.

## Tests

Backend:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
$env:PYTHONPATH=(Get-Location).Path
pytest
python -m compileall app
```

Frontend:

```powershell
cd frontend
npm run build
```

End-to-end browser test:

```powershell
cd frontend
npm run e2e:install
npm run e2e
```

The e2e suite starts its own FastAPI server on `127.0.0.1:8010` and Vite server on `127.0.0.1:5174`. It uses isolated local test storage under `frontend/.e2e/`, clears prior e2e projects at startup, creates generated image/GLB fixtures at runtime, creates an environment variant, uploads source/panorama files through Environment Builder, saves calibration, verifies prompt copying and activation, verifies calibrated character defaults, verifies the 3D canvas can render/export, checks autosave, reset transform, calibrated transform helpers, focus selected, clean screenshot export, JSON/ZIP exports, scene ordering, missing favicon/static resources, and project deletion.

## Milestone 7 Manual Test

1. Start the backend with `uvicorn app.main:app --reload --host 127.0.0.1 --port 8000`.
2. Start the frontend with `npm run dev`.
3. Open `http://127.0.0.1:5173`.
4. Open an existing project.
5. Select `Base Scene`.
6. Open Environment Builder.
7. Create an environment variant.
8. Upload a normal source image.
9. Generate prompts and copy the panorama prompt/manual instructions.
10. Upload a generated 2:1 panorama image.
11. Set Horizon Y, Floor Y, Placement radius, Default scale, Camera height, and click `Save calibration`.
12. Toggle calibration guides and confirm the horizon overlay, floor grid, placement circle, and camera-height marker hide/show.
13. Activate the variant and confirm the 360 viewer loads it.
14. Upload a GLB if needed.
15. Add a character placement and confirm it uses the active floor, placement radius, and default scale.
16. Use Drop to floor, Placement radius, Default scale, Calibrated reset, Reset transform, and Focus selected on the character.
17. Adjust the camera view, Zoom / FOV, Eye-level, Top-down, and Face selected.
18. Click `Save camera`.
19. Fill shot number, shot size, camera move, action notes, and prompt notes; confirm autosave reaches Saved.
20. Enable Clean export and click `Download screenshot`.
21. Click `Download scene JSON` and confirm calibration data is present.
22. Copy the image prompt and video prompt.
23. Duplicate or create a scene state.
24. Move the character in the duplicated state.
25. Use Up/Down to reorder scene states.
26. Switch between states and confirm camera framing and placements change.
27. Click `Download project package` and confirm `environment_calibration.json` is included.
28. Rename the project and save it.
29. Delete a disposable project and confirm it returns to the project list.
30. Run backend tests, frontend build, and e2e.

## Future Module Boundaries

The current app keeps project metadata and upload workflows separate from the viewer component so later modules can be added without replacing the foundation:

- Provider adapters

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  api,
  assetUrl,
  CameraMove,
  CameraSnapshot,
  CharacterAsset,
  CharacterInstance,
  CharacterInstanceUpdate,
  Project,
  SceneState,
  SceneStateUpdate,
  ShotSize,
} from "../api";
import PanoramaViewer, { PanoramaViewerHandle, TransformMode } from "../components/PanoramaViewer";
import UploadPanel from "../components/UploadPanel";

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const CAMERA_FOV_MIN = 20;
const CAMERA_FOV_MAX = 120;
const DRONE_CAMERA_SNAPSHOT: CameraSnapshot = {
  position: { x: 0, y: 7, z: 0.01 },
  target: { x: 0, y: 0, z: 0 },
  fov: 55,
};
const SHOT_SIZES: ShotSize[] = ["WIDE", "MS", "CU", "ECU"];
const CAMERA_MOVES: CameraMove[] = [
  "static",
  "push",
  "pull",
  "pan",
  "tilt",
  "handheld",
  "orbit",
  "dolly",
  "zoom",
];
type InspectorTab = "setup" | "shot" | "characters" | "export";

export default function ProjectEditor() {
  const params = useParams();
  const projectId = Number(params.projectId);
  const modelInputRef = useRef<HTMLInputElement | null>(null);
  const viewerRef = useRef<PanoramaViewerHandle | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [sceneStates, setSceneStates] = useState<SceneState[]>([]);
  const [selectedSceneStateId, setSelectedSceneStateId] = useState<number | null>(null);
  const [assets, setAssets] = useState<CharacterAsset[]>([]);
  const [instances, setInstances] = useState<CharacterInstance[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<number | null>(null);
  const [transformMode, setTransformMode] = useState<TransformMode>("translate");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sceneSaving, setSceneSaving] = useState(false);
  const [sceneSaveStatus, setSceneSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [assetBusy, setAssetBusy] = useState(false);
  const [panelsCollapsed, setPanelsCollapsed] = useState(false);
  const [showGuide, setShowGuide] = useState(true);
  const [activeInspectorTab, setActiveInspectorTab] = useState<InspectorTab>("setup");
  const [error, setError] = useState<string | null>(null);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [instanceError, setInstanceError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(projectId)) {
      setError("Invalid project id.");
      setLoading(false);
      return;
    }

    async function loadEditor() {
      try {
        const [loadedProject, loadedAssets, loadedSceneStates] = await Promise.all([
          api.getProject(projectId),
          api.listCharacterAssets(projectId),
          api.listSceneStates(projectId),
        ]);
        const selectedSceneState = loadedSceneStates[0] ?? null;
        const loadedInstances = selectedSceneState
          ? await api.listCharacterInstances(projectId, selectedSceneState.id)
          : [];
        setProject(loadedProject);
        setAssets(loadedAssets);
        setSceneStates(loadedSceneStates);
        setSelectedSceneStateId(selectedSceneState?.id ?? null);
        setInstances(loadedInstances);
        setSelectedInstanceId(loadedInstances[0]?.id ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load project.");
      } finally {
        setLoading(false);
      }
    }

    void loadEditor();
  }, [projectId]);

  const selectedInstance =
    instances.find((instance) => instance.id === selectedInstanceId) ?? null;
  const selectedSceneState =
    sceneStates.find((state) => state.id === selectedSceneStateId) ?? null;

  if (loading) {
    return (
      <main className="app-shell">
        <p className="muted">Opening project...</p>
      </main>
    );
  }

  if (error || !project) {
    return (
      <main className="app-shell">
        <Link className="back-link" to="/">
          Back to projects
        </Link>
        <p className="error-text">{error || "Project not found."}</p>
      </main>
    );
  }

  const activeProject = project;
  const sourceUrl = assetUrl(project.source_image_path);
  const panoramaUrl = assetUrl(project.panorama_image_path);
  const prompts = selectedSceneState
    ? buildPrompts(activeProject, selectedSceneState, instances)
    : null;
  const cameraSnapshot = selectedSceneState
    ? sceneStateCameraSnapshot(selectedSceneState)
    : defaultCameraSnapshot();
  const selectedSceneLabel = selectedSceneState
    ? `Shot ${selectedSceneState.shot_number} / ${selectedSceneState.shot_size} / ${selectedSceneState.camera_move}`
    : "No scene";

  function mergeInstance(instanceId: number, patch: CharacterInstanceUpdate) {
    setInstances((current) =>
      current.map((instance) =>
        instance.id === instanceId ? { ...instance, ...patch } : instance,
      ),
    );
  }

  async function persistInstance(instanceId: number, patch: CharacterInstanceUpdate) {
    setSaving(true);
    setInstanceError(null);
    try {
      const updated = await api.updateCharacterInstance(activeProject.id, instanceId, patch);
      setInstances((current) =>
        current.map((instance) => (instance.id === updated.id ? updated : instance)),
      );
    } catch (err) {
      setInstanceError(err instanceof Error ? err.message : "Could not update instance.");
    } finally {
      setSaving(false);
    }
  }

  async function persistSelectedInstanceBeforeSceneChange(): Promise<boolean> {
    if (!selectedInstance) {
      return true;
    }

    setSaving(true);
    setInstanceError(null);
    try {
      const updated = await api.updateCharacterInstance(
        activeProject.id,
        selectedInstance.id,
        instancePatch(selectedInstance),
      );
      setInstances((current) =>
        current.map((instance) => (instance.id === updated.id ? updated : instance)),
      );
      return true;
    } catch (err) {
      setInstanceError(err instanceof Error ? err.message : "Could not save current transform.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function loadInstancesForScene(sceneStateId: number) {
    setInstanceError(null);
    const loadedInstances = await api.listCharacterInstances(activeProject.id, sceneStateId);
    setInstances(loadedInstances);
    setSelectedInstanceId((current) =>
      loadedInstances.some((instance) => instance.id === current)
        ? current
        : (loadedInstances[0]?.id ?? null),
    );
  }

  async function selectSceneState(sceneStateId: number) {
    if (sceneStateId === selectedSceneStateId) {
      return;
    }
    const savedCurrentInstance = await persistSelectedInstanceBeforeSceneChange();
    if (!savedCurrentInstance) {
      return;
    }
    const savedCurrentCamera = await persistCurrentCameraBeforeSceneChange();
    if (!savedCurrentCamera) {
      return;
    }

    setSelectedSceneStateId(sceneStateId);
    try {
      await loadInstancesForScene(sceneStateId);
    } catch (err) {
      setSceneError(err instanceof Error ? err.message : "Could not load scene state.");
    }
  }

  function mergeSceneState(sceneStateId: number, patch: Partial<SceneState>) {
    setSceneSaveStatus("idle");
    setSceneStates((current) =>
      current.map((state) => (state.id === sceneStateId ? { ...state, ...patch } : state)),
    );
  }

  async function persistCurrentCameraBeforeSceneChange(): Promise<boolean> {
    if (!selectedSceneState) {
      return true;
    }

    const snapshot = viewerRef.current?.getCameraSnapshot();
    if (!snapshot) {
      return true;
    }

    setSceneError(null);
    try {
      const updated = await api.updateSceneState(
        activeProject.id,
        selectedSceneState.id,
        cameraSnapshotPatch(snapshot),
      );
      setSceneStates((current) =>
        current.map((state) => (state.id === updated.id ? updated : state)),
      );
      return true;
    } catch (err) {
      setSceneError(err instanceof Error ? err.message : "Could not save current camera.");
      return false;
    }
  }

  async function createSceneState() {
    setSceneSaving(true);
    setSceneSaveStatus("idle");
    setSceneError(null);
    try {
      const savedCurrentInstance = await persistSelectedInstanceBeforeSceneChange();
      if (!savedCurrentInstance) {
        return;
      }
      const savedCurrentCamera = await persistCurrentCameraBeforeSceneChange();
      if (!savedCurrentCamera) {
        return;
      }
      const state = await api.createSceneState(activeProject.id, {
        name: `Scene ${sceneStates.length + 1}`,
        description: "",
      });
      setSceneStates((current) => [...current, state]);
      setSelectedSceneStateId(state.id);
      setInstances([]);
      setSelectedInstanceId(null);
    } catch (err) {
      setSceneError(err instanceof Error ? err.message : "Could not create scene state.");
    } finally {
      setSceneSaving(false);
    }
  }

  async function saveSelectedSceneState() {
    if (!selectedSceneState) {
      return;
    }

    setSceneSaving(true);
    setSceneError(null);
    try {
      const updated = await api.updateSceneState(activeProject.id, selectedSceneState.id, {
        name: selectedSceneState.name,
        description: selectedSceneState.description,
        shot_number: selectedSceneState.shot_number,
        shot_size: selectedSceneState.shot_size,
        camera_move: selectedSceneState.camera_move,
        action_notes: selectedSceneState.action_notes,
        prompt_notes: selectedSceneState.prompt_notes,
      });
      setSceneStates((current) =>
        current.map((state) =>
          state.id === updated.id ? preserveLocalCameraFields(updated, state) : state,
        ),
      );
      setSceneSaveStatus("saved");
    } catch (err) {
      setSceneSaveStatus("error");
      setSceneError(err instanceof Error ? err.message : "Could not save scene state.");
    } finally {
      setSceneSaving(false);
    }
  }

  async function duplicateSelectedSceneState() {
    if (!selectedSceneState) {
      return;
    }

    setSceneSaving(true);
    setSceneError(null);
    try {
      const savedCurrentInstance = await persistSelectedInstanceBeforeSceneChange();
      if (!savedCurrentInstance) {
        return;
      }
      const savedCurrentCamera = await persistCurrentCameraBeforeSceneChange();
      if (!savedCurrentCamera) {
        return;
      }
      const duplicated = await api.duplicateSceneState(activeProject.id, selectedSceneState.id);
      const loadedSceneStates = await api.listSceneStates(activeProject.id);
      setSceneStates(loadedSceneStates);
      setSelectedSceneStateId(duplicated.id);
      await loadInstancesForScene(duplicated.id);
    } catch (err) {
      setSceneError(err instanceof Error ? err.message : "Could not duplicate scene state.");
    } finally {
      setSceneSaving(false);
    }
  }

  async function deleteSelectedSceneState() {
    if (!selectedSceneState) {
      return;
    }

    setSceneSaving(true);
    setSceneError(null);
    try {
      await api.deleteSceneState(activeProject.id, selectedSceneState.id);
      const remaining = sceneStates.filter((state) => state.id !== selectedSceneState.id);
      setSceneStates(remaining);
      const nextState = remaining[0] ?? null;
      setSelectedSceneStateId(nextState?.id ?? null);
      if (nextState) {
        await loadInstancesForScene(nextState.id);
      } else {
        setInstances([]);
        setSelectedInstanceId(null);
      }
    } catch (err) {
      setSceneError(err instanceof Error ? err.message : "Could not delete scene state.");
    } finally {
      setSceneSaving(false);
    }
  }

  async function saveCameraToSelectedSceneState() {
    if (!selectedSceneState) {
      return;
    }
    const snapshot = viewerRef.current?.getCameraSnapshot();
    if (!snapshot) {
      setSceneError("Camera is not ready yet.");
      return;
    }

    const patch = cameraSnapshotPatch(snapshot);
    mergeSceneState(selectedSceneState.id, patch);
    setSceneSaving(true);
    setSceneSaveStatus("idle");
    setSceneError(null);
    try {
      const updated = await api.updateSceneState(activeProject.id, selectedSceneState.id, patch);
      setSceneStates((current) =>
        current.map((state) => (state.id === updated.id ? updated : state)),
      );
      setSceneSaveStatus("saved");
    } catch (err) {
      setSceneSaveStatus("error");
      setSceneError(err instanceof Error ? err.message : "Could not save camera.");
    } finally {
      setSceneSaving(false);
    }
  }

  function applyCameraSnapshotToSelectedSceneState(snapshot: CameraSnapshot) {
    if (!selectedSceneState) {
      return;
    }
    mergeSceneState(selectedSceneState.id, cameraSnapshotPatch(snapshot));
  }

  function downloadScreenshot() {
    if (!selectedSceneState) {
      return;
    }
    const dataUrl = viewerRef.current?.captureScreenshot();
    if (!dataUrl) {
      setSceneError("Screenshot is not ready yet.");
      return;
    }
    downloadUrl(dataUrl, `project-${activeProject.id}-scene-${selectedSceneState.id}.png`);
  }

  async function downloadSceneJson() {
    if (!selectedSceneState) {
      return;
    }
    setSceneError(null);
    try {
      const payload = await api.exportSceneJson(activeProject.id, selectedSceneState.id);
      downloadJson(payload, `project-${activeProject.id}-scene-${selectedSceneState.id}.json`);
    } catch (err) {
      setSceneError(err instanceof Error ? err.message : "Could not export scene JSON.");
    }
  }

  async function downloadProjectPackage() {
    setSceneError(null);
    try {
      const blob = await api.downloadProjectPackage(activeProject.id);
      downloadBlob(blob, `project-${activeProject.id}-export.zip`);
    } catch (err) {
      setSceneError(err instanceof Error ? err.message : "Could not export project package.");
    }
  }

  async function copyPrompt(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setSceneError("Could not copy to clipboard.");
    }
  }

  async function handleModelUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setAssetBusy(true);
    setAssetError(null);
    try {
      const asset = await api.uploadCharacterAsset(activeProject.id, file);
      setAssets((current) => [asset, ...current]);
    } catch (err) {
      setAssetError(err instanceof Error ? err.message : "Could not upload model.");
    } finally {
      setAssetBusy(false);
      event.target.value = "";
    }
  }

  async function addInstance(assetId: number) {
    setInstanceError(null);
    try {
      const instance = await api.createCharacterInstance(
        activeProject.id,
        assetId,
        selectedSceneStateId ?? undefined,
      );
      setInstances((current) => [instance, ...current]);
      setSelectedInstanceId(instance.id);
    } catch (err) {
      setInstanceError(err instanceof Error ? err.message : "Could not add character.");
    }
  }

  async function duplicateInstance(instanceId: number) {
    setInstanceError(null);
    try {
      const duplicate = await api.duplicateCharacterInstance(activeProject.id, instanceId);
      setInstances((current) => [duplicate, ...current]);
      setSelectedInstanceId(duplicate.id);
    } catch (err) {
      setInstanceError(err instanceof Error ? err.message : "Could not duplicate character.");
    }
  }

  async function deleteInstance(instanceId: number) {
    setInstanceError(null);
    try {
      await api.deleteCharacterInstance(activeProject.id, instanceId);
      setInstances((current) => current.filter((instance) => instance.id !== instanceId));
      if (selectedInstanceId === instanceId) {
        const next = instances.find((instance) => instance.id !== instanceId);
        setSelectedInstanceId(next?.id ?? null);
      }
    } catch (err) {
      setInstanceError(err instanceof Error ? err.message : "Could not delete character.");
    }
  }

  async function deleteAsset(assetId: number) {
    setAssetError(null);
    try {
      await api.deleteCharacterAsset(activeProject.id, assetId);
      setAssets((current) => current.filter((asset) => asset.id !== assetId));
    } catch (err) {
      setAssetError(err instanceof Error ? err.message : "Could not delete asset.");
    }
  }

  return (
    <main className={panelsCollapsed ? "editor-shell panels-collapsed" : "editor-shell"}>
      <header className="editor-appbar">
        <div className="appbar-brand">
          <Link className="back-link" to="/" aria-label="Back to projects" title="Back to projects">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M15 7H3.4l4.3-4.3L6.3 1.3l-6 6c-.2.2-.2.5 0 .7l6 6 1.4-1.4L3.4 9H15V7z"/></svg>
          </Link>
          <h1>{project.name}</h1>
        </div>
        <div className="appbar-scene">
          <span>{selectedSceneState?.name ?? "No scene"}</span>
          <span>{selectedSceneLabel}</span>
          <span>{panoramaUrl ? "Panorama loaded" : "No panorama"}</span>
        </div>
        <div className="appbar-actions">
          <button
            type="button"
            disabled={sceneSaving || !selectedSceneState}
            onClick={() => void saveSelectedSceneState()}
          >
            {sceneSaving ? "Saving..." : sceneSaveStatus === "saved" ? "Saved" : "Save"}
          </button>
          <button
            className="accent-action"
            type="button"
            aria-label="Open output panel"
            onClick={() => setActiveInspectorTab("export")}
          >
            Output
          </button>
        </div>
      </header>

      <div className="editor-workspace">
        <nav className="tool-strip" aria-label="Editor tools">
          <button type="button" title="Select" aria-label="Select">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 1l10 6.5L8.5 9l-2 5.5L3 1z"/></svg>
          </button>
          <button
            className={transformMode === "translate" ? "active" : ""}
            type="button"
            title="Move"
            onClick={() => setTransformMode("translate")}
          >
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1l2.5 3H9v3h3V5.5L15 8l-3 2.5V9H9v3h1.5L8 15l-2.5-3H7V9H4v1.5L1 8l3-2.5V7h3V4H5.5L8 1z"/></svg>
          </button>
          <button
            className={transformMode === "rotate" ? "active" : ""}
            type="button"
            title="Rotate"
            onClick={() => setTransformMode("rotate")}
          >
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M12 2.5V5h-1a5 5 0 1 0 1.5 4h1.6a6.5 6.5 0 1 1-2.1-5.5V1.5l3 2-3 2V2.5z"/></svg>
          </button>
          <button
            className={transformMode === "scale" ? "active" : ""}
            type="button"
            title="Scale"
            onClick={() => setTransformMode("scale")}
          >
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h5v1.5H4.5L8 7l-1 1-3.5-3.5V7H2V2zm12 12h-5v-1.5h2.5L8 9l1-1 3.5 3.5V9H14v5z"/></svg>
          </button>
          <div className="tool-strip-divider" />
          <button
            className={showGuide ? "active" : ""}
            type="button"
            title="Toggle grid guide"
            aria-pressed={showGuide}
            onClick={() => setShowGuide((visible) => !visible)}
          >
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 1h14v14H1V1zm1.5 1.5v4.25h4.25V2.5H2.5zm5.25 0v4.25h5.75V2.5H7.75zM2.5 7.75v5.75h4.25V7.75H2.5zm5.25 0v5.75h5.75V7.75H7.75z"/></svg>
          </button>
          <button
            className={panelsCollapsed ? "active" : ""}
            type="button"
            title="Toggle panels"
            onClick={() => setPanelsCollapsed((collapsed) => !collapsed)}
          >
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h12v12H2V2zm1.5 1.5v9h3.75v-9H3.5zm5.25 0v9h3.75v-9H8.75z"/></svg>
          </button>
        </nav>



      <section className="viewer-stage">
        <div className="viewer-toolbar">
          <span className="viewer-toolbar-title">{panoramaUrl ? selectedSceneState?.name ?? "360 Env" : "No panorama"} <span className="viewer-toolbar-sep">·</span> {selectedSceneLabel}</span>
          <span className="status-pill">{panoramaUrl ? "Texture loaded" : "Empty"}</span>
        </div>
        {selectedInstance ? (
          <div className="options-bar floating-transform-panel" aria-label="Selected object transform">
            <span className="options-label">Transform</span>
            <input
              className="options-input options-name"
              value={selectedInstance.name}
              onChange={(event) => mergeInstance(selectedInstance.id, { name: event.target.value })}
            />
            <div className="options-divider" />
            <div className="options-group">
              <span className="options-label">Position</span>
              <NumberField label="Left/Right" value={selectedInstance.position_x} onChange={(v) => mergeInstance(selectedInstance.id, { position_x: v })} />
              <NumberField label="Height" value={selectedInstance.position_y} onChange={(v) => mergeInstance(selectedInstance.id, { position_y: v })} />
              <NumberField label="Depth" value={selectedInstance.position_z} onChange={(v) => mergeInstance(selectedInstance.id, { position_z: v })} />
            </div>
            <div className="options-divider" />
            <div className="options-group">
              <span className="options-label">Rotation</span>
              <NumberField label="X" value={round(selectedInstance.rotation_x * RAD_TO_DEG)} onChange={(v) => mergeInstance(selectedInstance.id, { rotation_x: v * DEG_TO_RAD })} />
              <NumberField label="Y" value={round(selectedInstance.rotation_y * RAD_TO_DEG)} onChange={(v) => mergeInstance(selectedInstance.id, { rotation_y: v * DEG_TO_RAD })} />
              <NumberField label="Z" value={round(selectedInstance.rotation_z * RAD_TO_DEG)} onChange={(v) => mergeInstance(selectedInstance.id, { rotation_z: v * DEG_TO_RAD })} />
            </div>
            <div className="options-divider" />
            <div className="options-group">
              <span className="options-label">Scale</span>
              <NumberField label="" value={selectedInstance.scale} min={0.01} onChange={(v) => mergeInstance(selectedInstance.id, { scale: v })} />
            </div>
            <div className="options-divider" />
            <label className="options-check">
              <input type="checkbox" checked={selectedInstance.visible} onChange={(e) => mergeInstance(selectedInstance.id, { visible: e.target.checked })} />
              Vis
            </label>
            <div className="options-spacer" />
            <button className="options-save" type="button" disabled={saving} onClick={() => persistInstance(selectedInstance.id, instancePatch(selectedInstance))}>
              {saving ? "..." : "Save"}
            </button>
          </div>
        ) : null}
        <div className="canvas-shell">
          <div className="document-frame">
            <PanoramaViewer
              imageUrl={panoramaUrl}
              assets={assets}
              instances={instances}
              selectedInstanceId={selectedInstanceId}
              transformMode={transformMode}
              onSelectInstance={setSelectedInstanceId}
              onTransformChange={mergeInstance}
              onTransformCommit={persistInstance}
              cameraSnapshot={cameraSnapshot}
              showGuide={showGuide}
              viewerRef={viewerRef}
            />
          </div>

        </div>
        <div className="viewer-statusbar">
          <span>View 100%</span>
          <span>{showGuide ? "Guides on" : "Guides off"}</span>
          <span>{instances.length} objects</span>
          <span>{panoramaUrl ? "Equirectangular texture active" : "Upload a panorama to preview"}</span>
        </div>
      </section>

      <aside className="inspector-dock">
        <div className="inspector-tabs" aria-label="Inspector sections">
          <button
            className={activeInspectorTab === "setup" ? "active" : ""}
            type="button"
            onClick={() => setActiveInspectorTab("setup")}
          >
            Setup
          </button>
          <button
            className={activeInspectorTab === "shot" ? "active" : ""}
            type="button"
            onClick={() => setActiveInspectorTab("shot")}
          >
            Shot
          </button>
          <button
            className={activeInspectorTab === "characters" ? "active" : ""}
            type="button"
            onClick={() => setActiveInspectorTab("characters")}
          >
            Characters
          </button>
          <button
            className={activeInspectorTab === "export" ? "active" : ""}
            type="button"
            onClick={() => setActiveInspectorTab("export")}
          >
            Export
          </button>
        </div>

        <div className="inspector-scroll">
          {activeInspectorTab === "setup" ? (
            <>
              <UploadPanel
                title="Source reference"
                helperText="Normal room or environment image."
                buttonText="Upload source image"
                currentPath={project.source_image_path}
                onUpload={(file) => api.uploadSource(project.id, file)}
                onUploaded={setProject}
              />

              <UploadPanel
                title="360 panorama"
                helperText="2:1 equirectangular panorama, such as 4096x2048."
                buttonText="Upload panorama"
                currentPath={project.panorama_image_path}
                onUpload={(file) => api.uploadPanorama(project.id, file)}
                onUploaded={setProject}
                validateFile={validatePanoramaAspectRatio}
              />

              {sourceUrl ? (
                <section className="panel preview-panel">
                  <div className="panel-heading">
                    <h2>Source preview</h2>
                  </div>
                  <img src={sourceUrl} alt="Uploaded source reference" />
                </section>
              ) : null}
            </>
          ) : null}

          {activeInspectorTab === "shot" && selectedSceneState ? (
            <section className="panel scene-panel">
              <div className="panel-heading">
                <h2>Shot planner</h2>
                <span className={sceneSaveStatus === "saved" ? "badge ok" : "badge"}>
                  {sceneSaving ? "Saving" : sceneSaveStatus === "saved" ? "Saved" : "Ready"}
                </span>
              </div>
              <label>
                State name
                <input
                  value={selectedSceneState.name}
                  onChange={(event) =>
                    mergeSceneState(selectedSceneState.id, { name: event.target.value })
                  }
                />
              </label>
              <label>
                Description
                <textarea
                  rows={3}
                  value={selectedSceneState.description}
                  onChange={(event) =>
                    mergeSceneState(selectedSceneState.id, {
                      description: event.target.value,
                    })
                  }
                />
              </label>
              <div className="field-grid">
                <NumberField
                  label="Shot #"
                  min={1}
                  value={selectedSceneState.shot_number}
                  onChange={(value) =>
                    mergeSceneState(selectedSceneState.id, {
                      shot_number: Math.max(1, Math.round(value)),
                    })
                  }
                />
                <label>
                  Shot size
                  <select
                    value={selectedSceneState.shot_size}
                    onChange={(event) =>
                      mergeSceneState(selectedSceneState.id, {
                        shot_size: event.target.value as ShotSize,
                      })
                    }
                  >
                    {SHOT_SIZES.map((shotSize) => (
                      <option key={shotSize} value={shotSize}>
                        {shotSize}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Camera
                  <select
                    value={selectedSceneState.camera_move}
                    onChange={(event) =>
                      mergeSceneState(selectedSceneState.id, {
                        camera_move: event.target.value as CameraMove,
                      })
                    }
                  >
                    {CAMERA_MOVES.map((move) => (
                      <option key={move} value={move}>
                        {move}
                      </option>
                    ))}
                  </select>
                </label>
                <NumberField
                  label="Zoom / FOV"
                  min={CAMERA_FOV_MIN}
                  max={CAMERA_FOV_MAX}
                  value={selectedSceneState.camera_fov}
                  onChange={(value) =>
                    mergeSceneState(selectedSceneState.id, {
                      camera_fov: clamp(value, CAMERA_FOV_MIN, CAMERA_FOV_MAX),
                    })
                  }
                />
              </div>
              <label>
                Action notes
                <textarea
                  rows={5}
                  value={selectedSceneState.action_notes}
                  onChange={(event) =>
                    mergeSceneState(selectedSceneState.id, {
                      action_notes: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                Prompt notes
                <textarea
                  rows={5}
                  value={selectedSceneState.prompt_notes}
                  onChange={(event) =>
                    mergeSceneState(selectedSceneState.id, {
                      prompt_notes: event.target.value,
                    })
                  }
                />
              </label>
              <button
                className="primary-button"
                type="button"
                disabled={sceneSaving}
                data-testid="save-scene-state"
                onClick={() => void saveSelectedSceneState()}
              >
                {sceneSaving ? "Saving..." : sceneSaveStatus === "saved" ? "Saved" : "Save state"}
              </button>
              <div className="row-actions full-width">
                <button
                  type="button"
                  data-testid="drone-view"
                  onClick={() => applyCameraSnapshotToSelectedSceneState(DRONE_CAMERA_SNAPSHOT)}
                >
                  Drone view
                </button>
                <button
                  type="button"
                  disabled={sceneSaving}
                  data-testid="save-camera"
                  onClick={() => void saveCameraToSelectedSceneState()}
                >
                  Save camera
                </button>
                <button type="button" data-testid="download-screenshot" onClick={downloadScreenshot}>
                  Screenshot
                </button>
                <button
                  type="button"
                  data-testid="download-scene-json"
                  onClick={() => void downloadSceneJson()}
                >
                  Scene JSON
                </button>
              </div>
              {sceneError ? <p className="error-text">{sceneError}</p> : null}
            </section>
          ) : null}

          {activeInspectorTab === "characters" ? (
            <>
              <section className="panel character-panel">
                <div className="panel-heading">
                  <h2>Character assets</h2>
                  <span>{assets.length}</span>
                </div>
                <input
                  ref={modelInputRef}
                  type="file"
                  accept=".glb,model/gltf-binary"
                  onChange={handleModelUpload}
                  hidden
                />
                <button
                  className="secondary-button"
                  type="button"
                  disabled={assetBusy}
                  onClick={() => modelInputRef.current?.click()}
                >
                  {assetBusy ? "Uploading..." : "Upload GLB"}
                </button>
                <div className="asset-list">
                  {assets.map((asset) => (
                    <div className="asset-row" key={asset.id}>
                      <div>
                        <h3>{asset.name}</h3>
                        <p>{asset.model_path}</p>
                      </div>
                      <div className="row-actions">
                        <button type="button" onClick={() => addInstance(asset.id)}>
                          Add
                        </button>
                        <button type="button" onClick={() => deleteAsset(asset.id)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                  {assets.length === 0 ? <p className="muted">No GLB assets yet.</p> : null}
                </div>
                {assetError ? <p className="error-text">{assetError}</p> : null}
              </section>

              <section className="panel character-panel">
                <div className="panel-heading">
                  <h2>Objects</h2>
                  <span>{instances.length}</span>
                </div>
                <div className="object-list">
                  {instances.map((instance) => (
                    <button
                      className={
                        instance.id === selectedInstanceId ? "object-row selected" : "object-row"
                      }
                      key={instance.id}
                      type="button"
                      onClick={() => setSelectedInstanceId(instance.id)}
                    >
                      <span>{instance.name}</span>
                      <span>{instance.visible ? "Visible" : "Hidden"}</span>
                    </button>
                  ))}
                  {instances.length === 0 ? <p className="muted">No placed characters.</p> : null}
                </div>
                {selectedInstance ? (
                  <div className="row-actions full-width">
                    <button type="button" onClick={() => duplicateInstance(selectedInstance.id)}>
                      Duplicate
                    </button>
                    <button type="button" onClick={() => deleteInstance(selectedInstance.id)}>
                      Delete
                    </button>
                    <label className="inline-check">
                      <input
                        type="checkbox"
                        checked={selectedInstance.visible}
                        onChange={(event) => {
                          const patch = { visible: event.target.checked };
                          mergeInstance(selectedInstance.id, patch);
                          void persistInstance(selectedInstance.id, patch);
                        }}
                      />
                      Visible
                    </label>
                  </div>
                ) : null}
                {instanceError ? <p className="error-text">{instanceError}</p> : null}
              </section>

            </>
          ) : null}

          {activeInspectorTab === "export" && prompts ? (
            <section className="panel prompt-panel">
            <div className="panel-heading">
              <h2>Prompt export</h2>
              <span>Local</span>
            </div>
            <div className="row-actions full-width">
              <button type="button" data-testid="download-screenshot" onClick={downloadScreenshot}>
                Screenshot
              </button>
              <button
                type="button"
                data-testid="download-scene-json"
                onClick={() => void downloadSceneJson()}
              >
                Scene JSON
              </button>
            </div>
            <PromptBlock
              title="Image reference prompt"
              text={prompts.image}
              testId="copy-image-prompt"
              onCopy={() => void copyPrompt(prompts.image)}
            />
            <PromptBlock
              title="Video prompt"
              text={prompts.video}
              testId="copy-video-prompt"
              onCopy={() => void copyPrompt(prompts.video)}
            />
            <PromptBlock
              title="Negative / consistency"
              text={prompts.negative}
              testId="copy-negative-prompt"
              onCopy={() => void copyPrompt(prompts.negative)}
            />
            <PromptBlock
              title="Character placement summary"
              text={prompts.summary}
              testId="copy-character-summary"
              onCopy={() => void copyPrompt(prompts.summary)}
            />
            <button
              className="secondary-button"
              type="button"
              data-testid="download-project-package"
              onClick={() => void downloadProjectPackage()}
            >
              Download project package
            </button>
            </section>
          ) : null}
        </div>

        <div className="scene-header">
          Scenes <span style={{fontWeight: 'normal', color: 'var(--text-dim)'}}>{sceneStates.length}</span>
        </div>
        <div className="scene-list">
          {sceneStates.map((state, index) => (
            <button
              className={state.id === selectedSceneStateId ? "scene-row selected" : "scene-row"}
              data-testid={`scene-state-${state.id}`}
              key={state.id}
              type="button"
              onClick={() => void selectSceneState(state.id)}
            >
              <span>{state.name}</span>
              <small>
                {index === 0 ? "Base Scene" : `Scene ${index + 1}`} / {state.shot_size} / {state.camera_move}
              </small>
            </button>
          ))}
        </div>
        <div className="row-actions full-width" style={{borderTop: '1px solid var(--line-hard)', padding: '4px'}}>
          <button type="button" disabled={sceneSaving} onClick={() => void createSceneState()}>
            New
          </button>
          <button
            type="button"
            disabled={sceneSaving || !selectedSceneState}
            data-testid="duplicate-scene-state"
            onClick={() => void duplicateSelectedSceneState()}
          >
            Duplicate
          </button>
          <button type="button" disabled={sceneSaving || !selectedSceneState} onClick={() => void deleteSelectedSceneState()}>
            Delete
          </button>
        </div>
      </aside>
      </div>
    </main>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(formatNumberInput(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setDraft(formatNumberInput(value));
    }
  }, [focused, value]);

  function commitDraft(nextDraft: string) {
    const parsed = Number(nextDraft);
    if (!Number.isFinite(parsed)) {
      setDraft(formatNumberInput(value));
      return;
    }

    const nextValue = clampOptional(parsed, min, max);
    setDraft(formatNumberInput(nextValue));
    onChange(nextValue);
  }

  return (
    <label>
      {label}
      <input
        inputMode="decimal"
        type="text"
        value={draft}
        onBlur={() => {
          setFocused(false);
          commitDraft(draft);
        }}
        onChange={(event) => {
          const nextDraft = event.target.value;
          setDraft(nextDraft);
          if (isCompleteNumberInput(nextDraft)) {
            const parsed = Number(nextDraft);
            if (Number.isFinite(parsed)) {
              onChange(clampOptional(parsed, min, max));
            }
          }
        }}
        onFocus={() => setFocused(true)}
      />
    </label>
  );
}

function isCompleteNumberInput(value: string): boolean {
  return value.trim() !== "" && !["-", "+", ".", "-.", "+."].includes(value);
}

function formatNumberInput(value: number): string {
  return Number.isFinite(value) ? String(round(value)) : "0";
}

function clampOptional(value: number, min?: number, max?: number): number {
  return clamp(value, min ?? Number.NEGATIVE_INFINITY, max ?? Number.POSITIVE_INFINITY);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function instancePatch(instance: CharacterInstance): CharacterInstanceUpdate {
  return {
    name: instance.name,
    position_x: instance.position_x,
    position_y: instance.position_y,
    position_z: instance.position_z,
    rotation_x: instance.rotation_x,
    rotation_y: instance.rotation_y,
    rotation_z: instance.rotation_z,
    scale: instance.scale,
    visible: instance.visible,
  };
}

function preserveLocalCameraFields(updated: SceneState, current: SceneState): SceneState {
  return {
    ...updated,
    camera_position_x: current.camera_position_x,
    camera_position_y: current.camera_position_y,
    camera_position_z: current.camera_position_z,
    camera_target_x: current.camera_target_x,
    camera_target_y: current.camera_target_y,
    camera_target_z: current.camera_target_z,
    camera_fov: current.camera_fov,
  };
}

function defaultCameraSnapshot(): CameraSnapshot {
  return {
    position: { x: 0, y: 1.4, z: 0.2 },
    target: { x: 0, y: 1.4, z: -2 },
    fov: 75,
  };
}

function sceneStateCameraSnapshot(sceneState: SceneState): CameraSnapshot {
  return {
    position: {
      x: sceneState.camera_position_x,
      y: sceneState.camera_position_y,
      z: sceneState.camera_position_z,
    },
    target: {
      x: sceneState.camera_target_x,
      y: sceneState.camera_target_y,
      z: sceneState.camera_target_z,
    },
    fov: sceneState.camera_fov,
  };
}

function cameraSnapshotPatch(snapshot: CameraSnapshot): SceneStateUpdate {
  return {
    camera_position_x: round(snapshot.position.x),
    camera_position_y: round(snapshot.position.y),
    camera_position_z: round(snapshot.position.z),
    camera_target_x: round(snapshot.target.x),
    camera_target_y: round(snapshot.target.y),
    camera_target_z: round(snapshot.target.z),
    camera_fov: round(snapshot.fov),
  };
}

function buildPrompts(
  project: Project,
  sceneState: SceneState,
  instances: CharacterInstance[],
) {
  const summary = buildCharacterSummary(instances);
  const action = sceneState.action_notes.trim() || "No action notes provided.";
  const notes = sceneState.prompt_notes.trim() || "No extra style notes provided.";
  const image = [
    `Create a cinematic ${sceneState.shot_size} frame inside the provided 360 environment.`,
    `Project: ${project.name}.`,
    `Scene state: ${sceneState.name}.`,
    `Camera: FOV ${round(sceneState.camera_fov)}.`,
    `Characters: ${summary}.`,
    `Action: ${action}.`,
    `Style/notes: ${notes}.`,
    "Keep character identity and placement consistent with the reference layout.",
  ].join(" ");
  const video = [
    "Generate a short cinematic video based on this scene state.",
    `Camera move: ${sceneState.camera_move}.`,
    `Shot size: ${sceneState.shot_size}.`,
    `Character blocking: ${summary}.`,
    `Action: ${action}.`,
    "Preserve the same 360 environment, character positions, scale, and orientation unless the action notes specify movement.",
  ].join(" ");
  const negative = [
    "Avoid changing character identity, wardrobe, relative scale, or established placement.",
    "Avoid adding unlisted characters, changing the room layout, distorting anatomy, or drifting away from the saved camera framing.",
  ].join(" ");

  return { image, video, negative, summary };
}

function buildCharacterSummary(instances: CharacterInstance[]): string {
  if (instances.length === 0) {
    return "No characters placed.";
  }

  return instances
    .map((instance) => {
      const visibility = instance.visible ? "visible" : "hidden";
      return (
        `${instance.name} (${visibility}) at ` +
        `(${round(instance.position_x)}, ${round(instance.position_y)}, ${round(instance.position_z)}), ` +
        `rotation (${round(instance.rotation_x)}, ${round(instance.rotation_y)}, ${round(instance.rotation_z)}) radians, ` +
        `scale ${round(instance.scale)}`
      );
    })
    .join("; ");
}

function downloadUrl(url: string, filename: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function downloadJson(payload: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  downloadBlob(blob, filename);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  downloadUrl(url, filename);
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function PromptBlock({
  title,
  text,
  testId,
  onCopy,
}: {
  title: string;
  text: string;
  testId: string;
  onCopy: () => void;
}) {
  return (
    <div className="prompt-block">
      <div className="prompt-heading">
        <h3>{title}</h3>
        <button type="button" data-testid={testId} onClick={onCopy}>
          Copy
        </button>
      </div>
      <textarea readOnly rows={5} value={text} />
    </div>
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

async function validatePanoramaAspectRatio(file: File): Promise<string | null> {
  const dimensions = await readImageDimensions(file);
  if (!dimensions) {
    return null;
  }

  const ratio = dimensions.width / dimensions.height;
  if (Math.abs(ratio - 2) > 0.02) {
    return `This image is ${dimensions.width}x${dimensions.height}, not close to the required 2:1 panorama ratio.`;
  }

  return null;
}

function readImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };

    image.src = url;
  });
}

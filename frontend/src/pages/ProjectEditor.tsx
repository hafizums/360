import { ChangeEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  api,
  assetUrl,
  CameraMove,
  CameraSnapshot,
  CharacterAsset,
  CharacterInstance,
  CharacterInstanceUpdate,
  EnvironmentPromptBundle,
  EnvironmentVariant,
  Project,
  SceneState,
  SceneStateUpdate,
  ShotSize,
} from "../api";
import PanoramaViewer, {
  EnvironmentCalibration,
  PanoramaViewerHandle,
  TransformMode,
} from "../components/PanoramaViewer";
import UploadPanel from "../components/UploadPanel";

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const CAMERA_FOV_MIN = 20;
const CAMERA_FOV_MAX = 120;
const DEFAULT_ENVIRONMENT_CALIBRATION: EnvironmentCalibration & {
  default_character_scale: number;
  calibration_notes: string;
} = {
  horizon_y: 0.5,
  floor_y: 0,
  floor_grid_size: 16,
  floor_grid_divisions: 16,
  placement_radius: 3,
  default_character_scale: 1,
  camera_height: 1.4,
  calibration_notes: "",
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
type InspectorTab = "setup" | "environment" | "shot" | "characters" | "export";
type SaveStatus = "saved" | "unsaved" | "saving" | "error";

export default function ProjectEditor() {
  const navigate = useNavigate();
  const params = useParams();
  const projectId = Number(params.projectId);
  const modelInputRef = useRef<HTMLInputElement | null>(null);
  const environmentSourceInputRef = useRef<HTMLInputElement | null>(null);
  const environmentPanoramaInputRef = useRef<HTMLInputElement | null>(null);
  const viewerRef = useRef<PanoramaViewerHandle | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [sceneStates, setSceneStates] = useState<SceneState[]>([]);
  const [environmentVariants, setEnvironmentVariants] = useState<EnvironmentVariant[]>([]);
  const [selectedEnvironmentVariantId, setSelectedEnvironmentVariantId] = useState<number | null>(null);
  const [environmentPrompts, setEnvironmentPrompts] = useState<EnvironmentPromptBundle | null>(null);
  const [selectedSceneStateId, setSelectedSceneStateId] = useState<number | null>(null);
  const [assets, setAssets] = useState<CharacterAsset[]>([]);
  const [instances, setInstances] = useState<CharacterInstance[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<number | null>(null);
  const [transformMode, setTransformMode] = useState<TransformMode>("translate");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [projectSaving, setProjectSaving] = useState(false);
  const [projectDeleting, setProjectDeleting] = useState(false);
  const [sceneSaving, setSceneSaving] = useState(false);
  const [sceneSaveStatus, setSceneSaveStatus] = useState<SaveStatus>("saved");
  const [assetBusy, setAssetBusy] = useState(false);
  const [environmentBusy, setEnvironmentBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [panelsCollapsed, setPanelsCollapsed] = useState(false);
  const [showGuide, setShowGuide] = useState(true);
  const [showCalibrationGuide, setShowCalibrationGuide] = useState(true);
  const [cleanExport, setCleanExport] = useState(true);
  const [activeInspectorTab, setActiveInspectorTab] = useState<InspectorTab>("setup");
  const [error, setError] = useState<string | null>(null);
  const [projectStatus, setProjectStatus] = useState<string | null>(null);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [sceneStatusMessage, setSceneStatusMessage] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [assetStatus, setAssetStatus] = useState<string | null>(null);
  const [environmentError, setEnvironmentError] = useState<string | null>(null);
  const [environmentStatus, setEnvironmentStatus] = useState<string | null>(null);
  const [instanceError, setInstanceError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(projectId)) {
      setError("Invalid project id.");
      setLoading(false);
      return;
    }

    async function loadEditor() {
      try {
        const [loadedProject, loadedAssets, loadedSceneStates, loadedEnvironmentVariants] = await Promise.all([
          api.getProject(projectId),
          api.listCharacterAssets(projectId),
          api.listSceneStates(projectId),
          api.listEnvironmentVariants(projectId),
        ]);
        const selectedSceneState = loadedSceneStates[0] ?? null;
        const loadedInstances = selectedSceneState
          ? await api.listCharacterInstances(projectId, selectedSceneState.id)
          : [];
        setProject(loadedProject);
        setProjectName(loadedProject.name);
        setProjectDescription(loadedProject.description);
        setAssets(loadedAssets);
        setSceneStates(loadedSceneStates);
        setEnvironmentVariants(loadedEnvironmentVariants);
        setSelectedEnvironmentVariantId(
          loadedEnvironmentVariants.find((variant) => variant.is_active)?.id ??
            loadedEnvironmentVariants[0]?.id ??
            null,
        );
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
  const selectedEnvironmentVariant =
    environmentVariants.find((variant) => variant.id === selectedEnvironmentVariantId) ?? null;
  const activeEnvironmentVariant =
    environmentVariants.find((variant) => variant.is_active) ?? null;
  const activeCalibration = environmentCalibrationFromVariant(activeEnvironmentVariant);
  const selectedCalibration = environmentCalibrationFromVariant(selectedEnvironmentVariant);

  useEffect(() => {
    if (sceneSaveStatus !== "unsaved" || !selectedSceneState) {
      return;
    }

    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
    }

    const sceneStateId = selectedSceneState.id;
    autosaveTimerRef.current = window.setTimeout(() => {
      void saveSceneStateMetadata(sceneStateId, { autosave: true });
    }, 800);

    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [
    selectedSceneState?.id,
    selectedSceneState?.name,
    selectedSceneState?.description,
    selectedSceneState?.shot_number,
    selectedSceneState?.shot_size,
    selectedSceneState?.camera_move,
    selectedSceneState?.action_notes,
    selectedSceneState?.prompt_notes,
    sceneSaveStatus,
  ]);

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
    ? buildPrompts(activeProject, selectedSceneState, instances, activeEnvironmentVariant)
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
    const savedCurrentScene = await persistSelectedSceneStateBeforeSceneChange();
    if (!savedCurrentScene) {
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
      setSceneSaveStatus("saved");
      setSceneStatusMessage(null);
    } catch (err) {
      setSceneError(err instanceof Error ? err.message : "Could not load scene state.");
    }
  }

  function mergeSceneState(sceneStateId: number, patch: Partial<SceneState>) {
    setSceneSaveStatus("unsaved");
    setSceneStatusMessage(null);
    setSceneStates((current) =>
      current.map((state) => (state.id === sceneStateId ? { ...state, ...patch } : state)),
    );
  }

  async function saveSceneStateMetadata(
    sceneStateId: number,
    options: { autosave?: boolean } = {},
  ): Promise<boolean> {
    const sceneState = sceneStates.find((state) => state.id === sceneStateId);
    if (!sceneState) {
      return true;
    }

    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    setSceneSaving(true);
    setSceneSaveStatus("saving");
    setSceneError(null);
    setSceneStatusMessage(null);
    try {
      const updated = await api.updateSceneState(activeProject.id, sceneState.id, {
        name: sceneState.name,
        description: sceneState.description,
        shot_number: sceneState.shot_number,
        shot_size: sceneState.shot_size,
        camera_move: sceneState.camera_move,
        action_notes: sceneState.action_notes,
        prompt_notes: sceneState.prompt_notes,
      });
      setSceneStates((current) =>
        current.map((state) =>
          state.id === updated.id ? preserveLocalCameraFields(updated, state) : state,
        ),
      );
      if (selectedSceneStateId === sceneStateId || !options.autosave) {
        setSceneSaveStatus("saved");
        setSceneStatusMessage("Scene state saved.");
      }
      return true;
    } catch (err) {
      if (selectedSceneStateId === sceneStateId || !options.autosave) {
        setSceneSaveStatus("error");
        setSceneError(err instanceof Error ? err.message : "Could not save scene state.");
      }
      return false;
    } finally {
      setSceneSaving(false);
    }
  }

  async function persistSelectedSceneStateBeforeSceneChange(): Promise<boolean> {
    if (!selectedSceneState || sceneSaveStatus === "saved") {
      return true;
    }
    return saveSceneStateMetadata(selectedSceneState.id);
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
    setSceneStatusMessage(null);
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
    setSceneError(null);
    try {
      const savedCurrentScene = await persistSelectedSceneStateBeforeSceneChange();
      if (!savedCurrentScene) {
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
      const state = await api.createSceneState(activeProject.id, {
        name: `Scene ${sceneStates.length + 1}`,
        description: "",
      });
      setSceneStates((current) => [...current, state]);
      setSelectedSceneStateId(state.id);
      setSceneSaveStatus("saved");
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

    await saveSceneStateMetadata(selectedSceneState.id);
  }

  async function duplicateSelectedSceneState() {
    if (!selectedSceneState) {
      return;
    }

    setSceneSaving(true);
    setSceneError(null);
    try {
      const savedCurrentScene = await persistSelectedSceneStateBeforeSceneChange();
      if (!savedCurrentScene) {
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
      const duplicated = await api.duplicateSceneState(activeProject.id, selectedSceneState.id);
      const loadedSceneStates = await api.listSceneStates(activeProject.id);
      setSceneStates(loadedSceneStates);
      setSelectedSceneStateId(duplicated.id);
      await loadInstancesForScene(duplicated.id);
      setSceneSaveStatus("saved");
      setSceneStatusMessage(null);
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
        setSceneSaveStatus("saved");
        setSceneStatusMessage(null);
      } else {
        setInstances([]);
        setSelectedInstanceId(null);
        setSceneSaveStatus("saved");
        setSceneStatusMessage(null);
      }
    } catch (err) {
      setSceneError(err instanceof Error ? err.message : "Could not delete scene state.");
    } finally {
      setSceneSaving(false);
    }
  }

  async function moveSelectedSceneState(direction: -1 | 1) {
    if (!selectedSceneState) {
      return;
    }

    const ordered = [...sceneStates].sort(compareSceneStates);
    const currentIndex = ordered.findIndex((state) => state.id === selectedSceneState.id);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= ordered.length) {
      return;
    }

    [ordered[currentIndex], ordered[nextIndex]] = [ordered[nextIndex], ordered[currentIndex]];
    const reordered = ordered.map((state, index) => ({ ...state, sort_order: index }));

    setSceneSaving(true);
    setSceneError(null);
    setSceneStates(reordered);
    try {
      await Promise.all(
        reordered.map((state) =>
          api.updateSceneState(activeProject.id, state.id, { sort_order: state.sort_order }),
        ),
      );
    } catch (err) {
      setSceneError(err instanceof Error ? err.message : "Could not reorder scenes.");
      const loadedSceneStates = await api.listSceneStates(activeProject.id);
      setSceneStates(loadedSceneStates);
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
    setSceneSaveStatus("saving");
    setSceneError(null);
    try {
      const updated = await api.updateSceneState(activeProject.id, selectedSceneState.id, patch);
      setSceneStates((current) =>
        current.map((state) => (state.id === updated.id ? updated : state)),
      );
      setSceneSaveStatus("saved");
      setSceneStatusMessage("Camera saved.");
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

  async function saveProjectMetadata() {
    setProjectSaving(true);
    setProjectStatus(null);
    setError(null);
    try {
      const updated = await api.updateProject(activeProject.id, {
        name: projectName,
        description: projectDescription,
      });
      setProject(updated);
      setProjectName(updated.name);
      setProjectDescription(updated.description);
      setProjectStatus("Project saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save project.");
    } finally {
      setProjectSaving(false);
    }
  }

  async function deleteCurrentProject() {
    if (!window.confirm("Delete this project and its local uploads? This cannot be undone.")) {
      return;
    }

    setProjectDeleting(true);
    setError(null);
    try {
      await api.deleteProject(activeProject.id);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete project.");
      setProjectDeleting(false);
    }
  }

  async function resetSelectedTransform() {
    if (!selectedInstance) {
      return;
    }
    const patch: CharacterInstanceUpdate = {
      position_x: 0,
      position_y: 0,
      position_z: -2,
      rotation_x: 0,
      rotation_y: 0,
      rotation_z: 0,
      scale: 1,
    };
    mergeInstance(selectedInstance.id, patch);
    await persistInstance(selectedInstance.id, patch);
  }

  async function patchSelectedTransform(patch: CharacterInstanceUpdate) {
    if (!selectedInstance) {
      return;
    }
    mergeInstance(selectedInstance.id, patch);
    await persistInstance(selectedInstance.id, patch);
  }

  async function dropSelectedToFloor() {
    await patchSelectedTransform({ position_y: activeCalibration.floor_y });
  }

  async function moveSelectedToPlacementRadius() {
    if (!selectedInstance) {
      return;
    }
    const radius = activeCalibration.placement_radius;
    const length = Math.hypot(selectedInstance.position_x, selectedInstance.position_z);
    const patch =
      length > 0.001
        ? {
            position_x: round((selectedInstance.position_x / length) * radius),
            position_z: round((selectedInstance.position_z / length) * radius),
          }
        : { position_x: 0, position_z: -radius };
    await patchSelectedTransform(patch);
  }

  async function applyDefaultScaleToSelected() {
    await patchSelectedTransform({ scale: activeCalibration.default_character_scale });
  }

  async function resetSelectedToCalibratedDefault() {
    const patch: CharacterInstanceUpdate = {
      position_x: 0,
      position_y: activeCalibration.floor_y,
      position_z: -activeCalibration.placement_radius,
      rotation_x: 0,
      rotation_y: 0,
      rotation_z: 0,
      scale: activeCalibration.default_character_scale,
    };
    await patchSelectedTransform(patch);
  }

  function focusSelectedInstance() {
    if (!selectedInstance) {
      return;
    }
    viewerRef.current?.focusTarget({
      x: selectedInstance.position_x,
      y: selectedInstance.position_y,
      z: selectedInstance.position_z,
    });
  }

  function applyEyeLevelCamera() {
    applyCameraSnapshotToSelectedSceneState({
      position: { x: 0, y: activeCalibration.camera_height, z: 0.2 },
      target: { x: 0, y: activeCalibration.camera_height, z: -activeCalibration.placement_radius },
      fov: cameraSnapshot.fov,
    });
  }

  function applyTopDownCamera() {
    applyCameraSnapshotToSelectedSceneState({
      position: {
        x: 0,
        y: Math.max(activeCalibration.camera_height + 3, activeCalibration.floor_y + 7),
        z: 0.01,
      },
      target: { x: 0, y: activeCalibration.floor_y, z: 0 },
      fov: 55,
    });
  }

  function faceSelectedWithCamera() {
    if (!selectedInstance) {
      return;
    }
    const length = Math.hypot(selectedInstance.position_x, selectedInstance.position_z);
    const directionX = length > 0.001 ? selectedInstance.position_x / length : 0;
    const directionZ = length > 0.001 ? selectedInstance.position_z / length : -1;
    const cameraDistance = Math.max(1.5, activeCalibration.placement_radius * 0.45);
    applyCameraSnapshotToSelectedSceneState({
      position: {
        x: selectedInstance.position_x - directionX * cameraDistance,
        y: activeCalibration.camera_height,
        z: selectedInstance.position_z - directionZ * cameraDistance,
      },
      target: {
        x: selectedInstance.position_x,
        y: selectedInstance.position_y + activeCalibration.camera_height * 0.65,
        z: selectedInstance.position_z,
      },
      fov: cameraSnapshot.fov,
    });
  }

  async function downloadScreenshot() {
    if (!selectedSceneState) {
      return;
    }
    setExportBusy(true);
    setExportStatus(null);
    const restoreGuides = cleanExport && showGuide;
    const restoreCalibrationGuides = cleanExport && showCalibrationGuide;
    try {
      if (restoreGuides) {
        setShowGuide(false);
      }
      if (restoreCalibrationGuides) {
        setShowCalibrationGuide(false);
      }
      if (restoreGuides || restoreCalibrationGuides) {
        await waitForViewerFrame();
      }
      const dataUrl = viewerRef.current?.captureScreenshot();
      if (!dataUrl) {
        setSceneError("Screenshot is not ready yet.");
        return;
      }
      downloadUrl(
        dataUrl,
        `project-${activeProject.id}-shot-${selectedSceneState.shot_number}-scene-${selectedSceneState.id}.png`,
      );
      setExportStatus("Screenshot downloaded.");
    } finally {
      if (restoreGuides) {
        setShowGuide(true);
      }
      if (restoreCalibrationGuides) {
        setShowCalibrationGuide(true);
      }
      setExportBusy(false);
    }
  }

  async function downloadSceneJson() {
    if (!selectedSceneState) {
      return;
    }
    setExportBusy(true);
    setExportStatus(null);
    setSceneError(null);
    try {
      const payload = await api.exportSceneJson(activeProject.id, selectedSceneState.id);
      downloadJson(
        payload,
        `project-${activeProject.id}-shot-${selectedSceneState.shot_number}-scene-${selectedSceneState.id}.json`,
      );
      setExportStatus("JSON downloaded.");
    } catch (err) {
      setSceneError(err instanceof Error ? err.message : "Could not export scene JSON.");
    } finally {
      setExportBusy(false);
    }
  }

  async function downloadProjectPackage() {
    setExportBusy(true);
    setExportStatus(null);
    setSceneError(null);
    try {
      const blob = await api.downloadProjectPackage(activeProject.id);
      downloadBlob(blob, `project-${activeProject.id}-export.zip`);
      setExportStatus("Package downloaded.");
    } catch (err) {
      setSceneError(err instanceof Error ? err.message : "Could not export project package.");
    } finally {
      setExportBusy(false);
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
    setAssetStatus(null);
    try {
      const asset = await api.uploadCharacterAsset(activeProject.id, file);
      setAssets((current) => [asset, ...current]);
      setAssetStatus("GLB uploaded.");
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

  function replaceEnvironmentVariant(updated: EnvironmentVariant) {
    setEnvironmentVariants((current) =>
      current.map((variant) => (variant.id === updated.id ? updated : variant)),
    );
  }

  function mergeSelectedEnvironmentVariant(patch: Partial<EnvironmentVariant>) {
    if (!selectedEnvironmentVariant) {
      return;
    }
    replaceEnvironmentVariant({ ...selectedEnvironmentVariant, ...patch });
    setEnvironmentStatus("Calibration unsaved.");
    setEnvironmentError(null);
  }

  async function createEnvironmentVariant() {
    setEnvironmentBusy(true);
    setEnvironmentError(null);
    setEnvironmentStatus(null);
    try {
      const variant = await api.createEnvironmentVariant(activeProject.id, {
        name: `Environment ${environmentVariants.length + 1}`,
        notes: "",
        width: 4096,
        height: 2048,
      });
      setEnvironmentVariants((current) => [variant, ...current]);
      setSelectedEnvironmentVariantId(variant.id);
      setEnvironmentPrompts(null);
      setEnvironmentStatus("Environment variant created.");
    } catch (err) {
      setEnvironmentError(err instanceof Error ? err.message : "Could not create environment.");
    } finally {
      setEnvironmentBusy(false);
    }
  }

  async function updateSelectedEnvironmentVariant(patch: Partial<EnvironmentVariant>) {
    if (!selectedEnvironmentVariant) {
      return;
    }
    const local = { ...selectedEnvironmentVariant, ...patch };
    replaceEnvironmentVariant(local);
    setEnvironmentError(null);
    setEnvironmentStatus(null);
    try {
      const updated = await api.updateEnvironmentVariant(
        activeProject.id,
        selectedEnvironmentVariant.id,
        patch,
      );
      replaceEnvironmentVariant(updated);
      setEnvironmentStatus("Environment saved.");
    } catch (err) {
      setEnvironmentError(err instanceof Error ? err.message : "Could not save environment.");
    }
  }

  async function saveSelectedEnvironmentCalibration(
    patchOverride?: Partial<EnvironmentVariant>,
  ) {
    if (!selectedEnvironmentVariant) {
      return;
    }
    const source = { ...selectedEnvironmentVariant, ...patchOverride };
    const patch = {
      horizon_y: source.horizon_y,
      floor_y: source.floor_y,
      floor_grid_size: source.floor_grid_size,
      floor_grid_divisions: Math.round(source.floor_grid_divisions),
      placement_radius: source.placement_radius,
      default_character_scale: source.default_character_scale,
      camera_height: source.camera_height,
      calibration_notes: source.calibration_notes,
    };
    replaceEnvironmentVariant({ ...selectedEnvironmentVariant, ...patch });
    setEnvironmentBusy(true);
    setEnvironmentError(null);
    try {
      const updated = await api.updateEnvironmentVariant(
        activeProject.id,
        selectedEnvironmentVariant.id,
        patch,
      );
      replaceEnvironmentVariant(updated);
      setEnvironmentStatus("Calibration saved.");
    } catch (err) {
      setEnvironmentError(err instanceof Error ? err.message : "Could not save calibration.");
    } finally {
      setEnvironmentBusy(false);
    }
  }

  async function resetSelectedEnvironmentCalibration() {
    await saveSelectedEnvironmentCalibration(DEFAULT_ENVIRONMENT_CALIBRATION);
  }

  async function handleEnvironmentSourceUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !selectedEnvironmentVariant) {
      return;
    }
    setEnvironmentBusy(true);
    setEnvironmentError(null);
    setEnvironmentStatus(null);
    try {
      const updated = await api.uploadEnvironmentSource(
        activeProject.id,
        selectedEnvironmentVariant.id,
        file,
      );
      replaceEnvironmentVariant(updated);
      setEnvironmentStatus("Source image uploaded.");
    } catch (err) {
      setEnvironmentError(err instanceof Error ? err.message : "Could not upload source image.");
    } finally {
      setEnvironmentBusy(false);
      event.target.value = "";
    }
  }

  async function handleEnvironmentPanoramaUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !selectedEnvironmentVariant) {
      return;
    }
    setEnvironmentBusy(true);
    setEnvironmentError(null);
    setEnvironmentStatus(null);
    try {
      const updated = await api.uploadEnvironmentPanorama(
        activeProject.id,
        selectedEnvironmentVariant.id,
        file,
      );
      replaceEnvironmentVariant(updated);
      if (updated.is_active) {
        const refreshedProject = await api.getProject(activeProject.id);
        setProject(refreshedProject);
      }
      setEnvironmentStatus("Panorama uploaded.");
    } catch (err) {
      setEnvironmentError(err instanceof Error ? err.message : "Could not upload panorama.");
    } finally {
      setEnvironmentBusy(false);
      event.target.value = "";
    }
  }

  async function generateEnvironmentPrompts() {
    if (!selectedEnvironmentVariant) {
      return;
    }
    setEnvironmentBusy(true);
    setEnvironmentError(null);
    setEnvironmentStatus(null);
    try {
      const prompts = await api.generateEnvironmentPrompts(
        activeProject.id,
        selectedEnvironmentVariant.id,
      );
      const updated = await api.updateEnvironmentVariant(activeProject.id, selectedEnvironmentVariant.id, {});
      replaceEnvironmentVariant(updated);
      setEnvironmentPrompts(prompts);
      setEnvironmentStatus("Environment prompts generated.");
    } catch (err) {
      setEnvironmentError(err instanceof Error ? err.message : "Could not generate prompts.");
    } finally {
      setEnvironmentBusy(false);
    }
  }

  async function activateEnvironmentVariant() {
    if (!selectedEnvironmentVariant) {
      return;
    }
    setEnvironmentBusy(true);
    setEnvironmentError(null);
    setEnvironmentStatus(null);
    try {
      const activated = await api.activateEnvironmentVariant(
        activeProject.id,
        selectedEnvironmentVariant.id,
      );
      const [variants, refreshedProject] = await Promise.all([
        api.listEnvironmentVariants(activeProject.id),
        api.getProject(activeProject.id),
      ]);
      setEnvironmentVariants(variants);
      setSelectedEnvironmentVariantId(activated.id);
      setProject(refreshedProject);
      setEnvironmentStatus("Environment activated.");
    } catch (err) {
      setEnvironmentError(err instanceof Error ? err.message : "Could not activate environment.");
    } finally {
      setEnvironmentBusy(false);
    }
  }

  async function deleteSelectedEnvironmentVariant() {
    if (!selectedEnvironmentVariant) {
      return;
    }
    if (!window.confirm("Delete this environment variant?")) {
      return;
    }
    setEnvironmentBusy(true);
    setEnvironmentError(null);
    setEnvironmentStatus(null);
    try {
      await api.deleteEnvironmentVariant(activeProject.id, selectedEnvironmentVariant.id);
      const [variants, refreshedProject] = await Promise.all([
        api.listEnvironmentVariants(activeProject.id),
        api.getProject(activeProject.id),
      ]);
      setEnvironmentVariants(variants);
      setSelectedEnvironmentVariantId(
        variants.find((variant) => variant.is_active)?.id ?? variants[0]?.id ?? null,
      );
      setProject(refreshedProject);
      setEnvironmentPrompts(null);
      setEnvironmentStatus("Environment deleted.");
    } catch (err) {
      setEnvironmentError(err instanceof Error ? err.message : "Could not delete environment.");
    } finally {
      setEnvironmentBusy(false);
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
            {sceneSaveStatus === "saving" ? "Saving..." : "Save"}
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
              showCalibrationGuide={showCalibrationGuide}
              calibration={activeCalibration}
              viewerRef={viewerRef}
            />
          </div>

        </div>
        <div className="viewer-statusbar">
          <span>View 100%</span>
          <span>{showGuide ? "Guides on" : "Guides off"}</span>
          <span>{showCalibrationGuide ? "Calibration on" : "Calibration off"}</span>
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
            className={activeInspectorTab === "environment" ? "active" : ""}
            type="button"
            onClick={() => setActiveInspectorTab("environment")}
          >
            Environment
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
              <section className="panel create-panel">
                <div className="panel-heading">
                  <h2>Project</h2>
                  <span className={projectStatus ? "badge ok" : "badge"}>{projectStatus ?? "Editable"}</span>
                </div>
                <label>
                  Name
                  <input
                    value={projectName}
                    onChange={(event) => {
                      setProjectName(event.target.value);
                      setProjectStatus(null);
                    }}
                  />
                </label>
                <label>
                  Description
                  <textarea
                    rows={3}
                    value={projectDescription}
                    onChange={(event) => {
                      setProjectDescription(event.target.value);
                      setProjectStatus(null);
                    }}
                  />
                </label>
                <div className="row-actions full-width">
                  <button
                    type="button"
                    disabled={projectSaving || projectDeleting}
                    onClick={() => void saveProjectMetadata()}
                  >
                    {projectSaving ? "Saving..." : "Save project"}
                  </button>
                  <button
                    type="button"
                    disabled={projectDeleting}
                    onClick={() => void deleteCurrentProject()}
                  >
                    {projectDeleting ? "Deleting..." : "Delete project"}
                  </button>
                </div>
                {error ? <p className="error-text">{error}</p> : null}
              </section>

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

          {activeInspectorTab === "environment" ? (
            <section className="panel scene-panel">
              <div className="panel-heading">
                <h2>Environment Builder</h2>
                <span>{environmentVariants.length}</span>
              </div>
              <div className="object-list">
                {environmentVariants.map((variant) => (
                  <button
                    className={
                      variant.id === selectedEnvironmentVariantId
                        ? "object-row selected"
                        : "object-row"
                    }
                    key={variant.id}
                    type="button"
                    onClick={() => {
                      setSelectedEnvironmentVariantId(variant.id);
                      setEnvironmentPrompts(null);
                    }}
                  >
                    <span>{variant.name}</span>
                    <span>{variant.is_active ? "Active" : variant.status}</span>
                  </button>
                ))}
                {environmentVariants.length === 0 ? (
                  <p className="muted">No environment variants yet.</p>
                ) : null}
              </div>
              <button
                className="secondary-button"
                type="button"
                disabled={environmentBusy}
                data-testid="create-environment-variant"
                onClick={() => void createEnvironmentVariant()}
              >
                New environment
              </button>

              {selectedEnvironmentVariant ? (
                <>
                  <label>
                    Variant name
                    <input
                      value={selectedEnvironmentVariant.name}
                      onChange={(event) =>
                        void updateSelectedEnvironmentVariant({ name: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Notes
                    <textarea
                      rows={4}
                      value={selectedEnvironmentVariant.notes}
                      onChange={(event) =>
                        void updateSelectedEnvironmentVariant({ notes: event.target.value })
                      }
                    />
                  </label>
                  <div className="field-grid">
                    <NumberField
                      label="Width"
                      min={512}
                      max={12000}
                      value={selectedEnvironmentVariant.width}
                      onChange={(value) =>
                        void updateSelectedEnvironmentVariant({ width: Math.round(value) })
                      }
                    />
                    <NumberField
                      label="Height"
                      min={256}
                      max={12000}
                      value={selectedEnvironmentVariant.height}
                      onChange={(value) =>
                        void updateSelectedEnvironmentVariant({ height: Math.round(value) })
                      }
                    />
                  </div>
                  <div className="calibration-panel" data-testid="calibration-panel">
                    <div className="panel-heading compact-heading">
                      <h2>Calibration</h2>
                      <label className="inline-check">
                        <input
                          type="checkbox"
                          checked={showCalibrationGuide}
                          onChange={(event) => setShowCalibrationGuide(event.target.checked)}
                        />
                        Show guides
                      </label>
                    </div>
                    <label>
                      Horizon Y
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={selectedCalibration.horizon_y}
                        data-testid="horizon-y"
                        onChange={(event) =>
                          mergeSelectedEnvironmentVariant({
                            horizon_y: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <div className="field-grid">
                      <NumberField
                        label="Floor Y"
                        value={selectedCalibration.floor_y}
                        onChange={(value) =>
                          mergeSelectedEnvironmentVariant({ floor_y: value })
                        }
                      />
                      <NumberField
                        label="Grid size"
                        min={1}
                        max={1000}
                        value={selectedCalibration.floor_grid_size}
                        onChange={(value) =>
                          mergeSelectedEnvironmentVariant({ floor_grid_size: value })
                        }
                      />
                      <NumberField
                        label="Grid divisions"
                        min={1}
                        max={256}
                        value={selectedCalibration.floor_grid_divisions}
                        onChange={(value) =>
                          mergeSelectedEnvironmentVariant({
                            floor_grid_divisions: Math.round(value),
                          })
                        }
                      />
                      <NumberField
                        label="Placement radius"
                        min={0.01}
                        max={1000}
                        value={selectedCalibration.placement_radius}
                        onChange={(value) =>
                          mergeSelectedEnvironmentVariant({ placement_radius: value })
                        }
                      />
                      <NumberField
                        label="Default scale"
                        min={0.01}
                        max={1000}
                        value={selectedCalibration.default_character_scale}
                        onChange={(value) =>
                          mergeSelectedEnvironmentVariant({ default_character_scale: value })
                        }
                      />
                      <NumberField
                        label="Camera height"
                        min={0.01}
                        max={1000}
                        value={selectedCalibration.camera_height}
                        onChange={(value) =>
                          mergeSelectedEnvironmentVariant({ camera_height: value })
                        }
                      />
                    </div>
                    <label>
                      Calibration notes
                      <textarea
                        rows={3}
                        value={selectedEnvironmentVariant.calibration_notes}
                        onChange={(event) =>
                          mergeSelectedEnvironmentVariant({
                            calibration_notes: event.target.value,
                          })
                        }
                      />
                    </label>
                    <div className="row-actions full-width">
                      <button
                        type="button"
                        disabled={environmentBusy}
                        data-testid="save-calibration"
                        onClick={() => void saveSelectedEnvironmentCalibration()}
                      >
                        Save calibration
                      </button>
                      <button
                        type="button"
                        disabled={environmentBusy}
                        data-testid="reset-calibration"
                        onClick={() => void resetSelectedEnvironmentCalibration()}
                      >
                        Reset calibration
                      </button>
                    </div>
                  </div>
                  <div className="row-actions full-width">
                    <input
                      ref={environmentSourceInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      hidden
                      onChange={handleEnvironmentSourceUpload}
                    />
                    <input
                      ref={environmentPanoramaInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      hidden
                      onChange={handleEnvironmentPanoramaUpload}
                    />
                    <button
                      type="button"
                      disabled={environmentBusy}
                      onClick={() => environmentSourceInputRef.current?.click()}
                    >
                      Upload source
                    </button>
                    <button
                      type="button"
                      disabled={environmentBusy}
                      onClick={() => environmentPanoramaInputRef.current?.click()}
                    >
                      Upload panorama
                    </button>
                  </div>
                  <p className="file-path">
                    Source: {selectedEnvironmentVariant.source_image_path ?? "not uploaded"}
                  </p>
                  <p className="file-path">
                    Panorama: {selectedEnvironmentVariant.panorama_image_path ?? "not uploaded"}
                  </p>
                  <div className="row-actions full-width">
                    <button
                      type="button"
                      disabled={environmentBusy}
                      data-testid="generate-environment-prompts"
                      onClick={() => void generateEnvironmentPrompts()}
                    >
                      Generate prompts
                    </button>
                    <button
                      type="button"
                      disabled={environmentBusy}
                      data-testid="activate-environment-variant"
                      onClick={() => void activateEnvironmentVariant()}
                    >
                      Activate
                    </button>
                    <button
                      type="button"
                      disabled={environmentBusy}
                      onClick={() => void deleteSelectedEnvironmentVariant()}
                    >
                      Delete
                    </button>
                  </div>
                  <PromptBlock
                    title="Source analysis checklist"
                    text={
                      environmentPrompts?.source_analysis_checklist ??
                      selectedEnvironmentVariant.source_prompt
                    }
                    testId="copy-source-checklist"
                    onCopy={() =>
                      void copyPrompt(
                        environmentPrompts?.source_analysis_checklist ??
                          selectedEnvironmentVariant.source_prompt,
                      )
                    }
                  />
                  <PromptBlock
                    title="Panorama generation prompt"
                    text={
                      environmentPrompts?.panorama_prompt ??
                      selectedEnvironmentVariant.panorama_prompt
                    }
                    testId="copy-panorama-prompt"
                    onCopy={() =>
                      void copyPrompt(
                        environmentPrompts?.panorama_prompt ??
                          selectedEnvironmentVariant.panorama_prompt,
                      )
                    }
                  />
                  <PromptBlock
                    title="Environment negative prompt"
                    text={
                      environmentPrompts?.negative_prompt ??
                      selectedEnvironmentVariant.negative_prompt
                    }
                    testId="copy-environment-negative"
                    onCopy={() =>
                      void copyPrompt(
                        environmentPrompts?.negative_prompt ??
                          selectedEnvironmentVariant.negative_prompt,
                      )
                    }
                  />
                  <PromptBlock
                    title="Manual instructions"
                    text={
                      environmentPrompts?.manual_instructions ??
                      buildManualEnvironmentInstructions()
                    }
                    testId="copy-manual-instructions"
                    onCopy={() =>
                      void copyPrompt(
                        environmentPrompts?.manual_instructions ??
                          buildManualEnvironmentInstructions(),
                      )
                    }
                  />
                </>
              ) : null}
              {environmentStatus ? <p className="success-text">{environmentStatus}</p> : null}
              {environmentError ? <p className="error-text">{environmentError}</p> : null}
            </section>
          ) : null}

          {activeInspectorTab === "shot" && selectedSceneState ? (
            <section className="panel scene-panel">
              <div className="panel-heading">
                <h2>Shot planner</h2>
                <span className={sceneSaveStatus === "saved" ? "badge ok" : "badge"}>
                  {formatSaveStatus(sceneSaveStatus)}
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
                  Camera move
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
                {sceneSaveStatus === "saving" ? "Saving..." : "Save state"}
              </button>
              <div className="row-actions full-width">
                <button
                  type="button"
                  data-testid="eye-level-camera"
                  onClick={applyEyeLevelCamera}
                >
                  Eye-level
                </button>
                <button
                  type="button"
                  data-testid="top-down-camera"
                  onClick={applyTopDownCamera}
                >
                  Top-down
                </button>
                <button
                  type="button"
                  disabled={!selectedInstance}
                  data-testid="face-selected-camera"
                  onClick={faceSelectedWithCamera}
                >
                  Face selected
                </button>
                <button
                  type="button"
                  disabled={sceneSaving}
                  data-testid="save-camera"
                  onClick={() => void saveCameraToSelectedSceneState()}
                >
                  Save camera
                </button>
                <button
                  type="button"
                  disabled={exportBusy}
                  data-testid="download-screenshot"
                  onClick={() => void downloadScreenshot()}
                >
                  Screenshot
                </button>
                <button
                  type="button"
                  disabled={exportBusy}
                  data-testid="download-scene-json"
                  onClick={() => void downloadSceneJson()}
                >
                  Scene JSON
                </button>
              </div>
              {sceneStatusMessage ? <p className="success-text">{sceneStatusMessage}</p> : null}
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
                {assetStatus ? <p className="success-text">{assetStatus}</p> : null}
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
                    <button
                      type="button"
                      data-testid="reset-transform"
                      onClick={() => void resetSelectedTransform()}
                    >
                      Reset transform
                    </button>
                    <button
                      type="button"
                      data-testid="drop-to-floor"
                      onClick={() => void dropSelectedToFloor()}
                    >
                      Drop to floor
                    </button>
                    <button
                      type="button"
                      data-testid="move-to-radius"
                      onClick={() => void moveSelectedToPlacementRadius()}
                    >
                      Placement radius
                    </button>
                    <button
                      type="button"
                      data-testid="apply-default-scale"
                      onClick={() => void applyDefaultScaleToSelected()}
                    >
                      Default scale
                    </button>
                    <button
                      type="button"
                      data-testid="reset-calibrated-transform"
                      onClick={() => void resetSelectedToCalibratedDefault()}
                    >
                      Calibrated reset
                    </button>
                    <button
                      type="button"
                      data-testid="focus-selected"
                      onClick={focusSelectedInstance}
                    >
                      Focus selected
                    </button>
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
                    <label className="inline-check">
                      <input
                        type="checkbox"
                        checked={!showGuide}
                        onChange={(event) => setShowGuide(!event.target.checked)}
                      />
                      Hide guides
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
            <label className="inline-check">
              <input
                type="checkbox"
                checked={cleanExport}
                onChange={(event) => setCleanExport(event.target.checked)}
              />
              Clean export: hide grid and transform controls in screenshot
            </label>
            <div className="row-actions full-width">
              <button
                type="button"
                disabled={exportBusy}
                data-testid="download-screenshot"
                onClick={() => void downloadScreenshot()}
              >
                {exportBusy ? "Working..." : "Screenshot"}
              </button>
              <button
                type="button"
                disabled={exportBusy}
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
              disabled={exportBusy}
              data-testid="download-project-package"
              onClick={() => void downloadProjectPackage()}
            >
              Download project package
            </button>
            {exportStatus ? <p className="success-text">{exportStatus}</p> : null}
            {sceneError ? <p className="error-text">{sceneError}</p> : null}
            </section>
          ) : null}
        </div>

        <div className="scene-header">
          Scenes <span style={{fontWeight: 'normal', color: 'var(--text-dim)'}}>{sceneStates.length}</span>
        </div>
        <div className="scene-list">
          {sceneStates.map((state) => (
            <button
              className={state.id === selectedSceneStateId ? "scene-row selected" : "scene-row"}
              data-testid={`scene-state-${state.id}`}
              key={state.id}
              type="button"
              onClick={() => void selectSceneState(state.id)}
            >
              <span>{state.name}</span>
              <small>
                Shot {state.shot_number} / {state.shot_size}
                {state.id === selectedSceneStateId ? ` / ${instances.length} objects` : ""}
              </small>
            </button>
          ))}
        </div>
        <div className="row-actions full-width" style={{borderTop: '1px solid var(--line-hard)', padding: '4px'}}>
          <button
            type="button"
            disabled={sceneSaving || !selectedSceneState}
            data-testid="move-scene-up"
            onClick={() => void moveSelectedSceneState(-1)}
          >
            Up
          </button>
          <button
            type="button"
            disabled={sceneSaving || !selectedSceneState}
            data-testid="move-scene-down"
            onClick={() => void moveSelectedSceneState(1)}
          >
            Down
          </button>
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

function formatSaveStatus(status: SaveStatus): string {
  if (status === "unsaved") {
    return "Unsaved";
  }
  if (status === "saving") {
    return "Saving";
  }
  if (status === "error") {
    return "Error";
  }
  return "Saved";
}

function compareSceneStates(a: SceneState, b: SceneState): number {
  return a.sort_order === b.sort_order ? a.id - b.id : a.sort_order - b.sort_order;
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

function environmentCalibrationFromVariant(
  variant: EnvironmentVariant | null,
): EnvironmentCalibration {
  return {
    horizon_y: variant?.horizon_y ?? DEFAULT_ENVIRONMENT_CALIBRATION.horizon_y,
    floor_y: variant?.floor_y ?? DEFAULT_ENVIRONMENT_CALIBRATION.floor_y,
    floor_grid_size:
      variant?.floor_grid_size ?? DEFAULT_ENVIRONMENT_CALIBRATION.floor_grid_size,
    floor_grid_divisions:
      variant?.floor_grid_divisions ?? DEFAULT_ENVIRONMENT_CALIBRATION.floor_grid_divisions,
    placement_radius:
      variant?.placement_radius ?? DEFAULT_ENVIRONMENT_CALIBRATION.placement_radius,
    default_character_scale:
      variant?.default_character_scale ??
      DEFAULT_ENVIRONMENT_CALIBRATION.default_character_scale,
    camera_height: variant?.camera_height ?? DEFAULT_ENVIRONMENT_CALIBRATION.camera_height,
  };
}

function buildPrompts(
  project: Project,
  sceneState: SceneState,
  instances: CharacterInstance[],
  environmentVariant: EnvironmentVariant | null,
) {
  const summary = buildCharacterSummary(instances);
  const calibration = environmentCalibrationFromVariant(environmentVariant);
  const calibrationSummary = environmentVariant
    ? `Environment calibration: horizon Y ${round(calibration.horizon_y)}, floor Y ${round(calibration.floor_y)}, placement radius ${round(calibration.placement_radius)}, default scale ${round(calibration.default_character_scale)}, camera height ${round(calibration.camera_height)}. ${environmentVariant.calibration_notes.trim() || "No calibration notes."}`
    : "No active environment calibration saved.";
  const action = sceneState.action_notes.trim() || "No action notes provided.";
  const notes = sceneState.prompt_notes.trim() || "No extra style notes provided.";
  const description = sceneState.description.trim() || "No scene description provided.";
  const image = [
    `Create a cinematic ${sceneState.shot_size} frame inside the provided 360 environment.`,
    `Project: ${project.name}.`,
    `Shot ${sceneState.shot_number}: ${sceneState.name}.`,
    `Scene description: ${description}.`,
    `Shot size: ${sceneState.shot_size}.`,
    `Camera move: ${sceneState.camera_move}.`,
    `Camera: FOV ${round(sceneState.camera_fov)}.`,
    calibrationSummary,
    `Characters: ${summary}.`,
    `Action: ${action}.`,
    `Style/notes: ${notes}.`,
    "Keep character identity and placement consistent with the reference layout.",
  ].join(" ");
  const video = [
    `Generate a short cinematic video for shot ${sceneState.shot_number}: ${sceneState.name}.`,
    `Camera move: ${sceneState.camera_move}.`,
    `Shot size: ${sceneState.shot_size}.`,
    `Scene description: ${description}.`,
    calibrationSummary,
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

function buildManualEnvironmentInstructions(): string {
  return [
    "1. Upload a normal source image.",
    "2. Copy the panorama prompt and negative prompt.",
    "3. Generate a 2:1 equirectangular image in an external AI image tool manually.",
    "4. Download the generated result.",
    "5. Upload the result as this panorama variant.",
    "6. Activate the variant.",
    "7. Continue character placement in the 360 editor.",
  ].join("\n");
}

function waitForViewerFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
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

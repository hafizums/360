import { ChangeEvent, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  api,
  assetUrl,
  CharacterAsset,
  CharacterInstance,
  CharacterInstanceUpdate,
  Project,
} from "../api";
import PanoramaViewer, { TransformMode } from "../components/PanoramaViewer";
import UploadPanel from "../components/UploadPanel";

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

export default function ProjectEditor() {
  const params = useParams();
  const projectId = Number(params.projectId);
  const modelInputRef = useRef<HTMLInputElement | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [assets, setAssets] = useState<CharacterAsset[]>([]);
  const [instances, setInstances] = useState<CharacterInstance[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<number | null>(null);
  const [transformMode, setTransformMode] = useState<TransformMode>("translate");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assetBusy, setAssetBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [instanceError, setInstanceError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(projectId)) {
      setError("Invalid project id.");
      setLoading(false);
      return;
    }

    Promise.all([
      api.getProject(projectId),
      api.listCharacterAssets(projectId),
      api.listCharacterInstances(projectId),
    ])
      .then(([loadedProject, loadedAssets, loadedInstances]) => {
        setProject(loadedProject);
        setAssets(loadedAssets);
        setInstances(loadedInstances);
        setSelectedInstanceId(loadedInstances[0]?.id ?? null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId]);

  const selectedInstance =
    instances.find((instance) => instance.id === selectedInstanceId) ?? null;

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
      const instance = await api.createCharacterInstance(activeProject.id, assetId);
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
    <main className="editor-shell">
      <aside className="sidebar">
        <Link className="back-link" to="/">
          Back to projects
        </Link>
        <div className="project-title">
          <p className="eyebrow">Project</p>
          <h1>{project.name}</h1>
          {project.description ? <p>{project.description}</p> : null}
        </div>

        <UploadPanel
          title="Source reference"
          helperText="Upload a normal room or environment image."
          buttonText="Upload source image"
          currentPath={project.source_image_path}
          onUpload={(file) => api.uploadSource(project.id, file)}
          onUploaded={setProject}
        />

        <UploadPanel
          title="360 panorama"
          helperText="Upload a 2:1 equirectangular panorama, such as 4096x2048."
          buttonText="Upload panorama"
          currentPath={project.panorama_image_path}
          onUpload={(file) => api.uploadPanorama(project.id, file)}
          onUploaded={setProject}
          validateFile={validatePanoramaAspectRatio}
        />

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

        {selectedInstance ? (
          <section className="panel inspector-panel">
            <div className="panel-heading">
              <h2>Inspector</h2>
              <span>{saving ? "Saving" : "Ready"}</span>
            </div>
            <label>
              Name
              <input
                value={selectedInstance.name}
                onChange={(event) =>
                  mergeInstance(selectedInstance.id, { name: event.target.value })
                }
              />
            </label>
            <div className="field-grid">
              <NumberField
                label="X"
                value={selectedInstance.position_x}
                onChange={(value) => mergeInstance(selectedInstance.id, { position_x: value })}
              />
              <NumberField
                label="Y"
                value={selectedInstance.position_y}
                onChange={(value) => mergeInstance(selectedInstance.id, { position_y: value })}
              />
              <NumberField
                label="Z"
                value={selectedInstance.position_z}
                onChange={(value) => mergeInstance(selectedInstance.id, { position_z: value })}
              />
            </div>
            <div className="field-grid">
              <NumberField
                label="Rot X"
                value={round(selectedInstance.rotation_x * RAD_TO_DEG)}
                onChange={(value) =>
                  mergeInstance(selectedInstance.id, { rotation_x: value * DEG_TO_RAD })
                }
              />
              <NumberField
                label="Rot Y"
                value={round(selectedInstance.rotation_y * RAD_TO_DEG)}
                onChange={(value) =>
                  mergeInstance(selectedInstance.id, { rotation_y: value * DEG_TO_RAD })
                }
              />
              <NumberField
                label="Rot Z"
                value={round(selectedInstance.rotation_z * RAD_TO_DEG)}
                onChange={(value) =>
                  mergeInstance(selectedInstance.id, { rotation_z: value * DEG_TO_RAD })
                }
              />
            </div>
            <NumberField
              label="Scale"
              value={selectedInstance.scale}
              min={0.01}
              onChange={(value) => mergeInstance(selectedInstance.id, { scale: value })}
            />
            <label className="inline-check">
              <input
                type="checkbox"
                checked={selectedInstance.visible}
                onChange={(event) =>
                  mergeInstance(selectedInstance.id, { visible: event.target.checked })
                }
              />
              Visible
            </label>
            <button
              className="primary-button"
              type="button"
              disabled={saving}
              onClick={() => persistInstance(selectedInstance.id, instancePatch(selectedInstance))}
            >
              {saving ? "Saving..." : "Save instance"}
            </button>
          </section>
        ) : null}

        {sourceUrl ? (
          <section className="panel preview-panel">
            <div className="panel-heading">
              <h2>Source preview</h2>
            </div>
            <img src={sourceUrl} alt="Uploaded source reference" />
          </section>
        ) : null}
      </aside>

      <section className="viewer-stage">
        <div className="viewer-toolbar">
          <div>
            <p className="eyebrow">Panorama editor</p>
            <h2>{panoramaUrl ? "360 environment" : "Waiting for panorama"}</h2>
          </div>
          <div className="mode-group" aria-label="Transform mode">
            <button
              className={transformMode === "translate" ? "active" : ""}
              type="button"
              onClick={() => setTransformMode("translate")}
            >
              Move
            </button>
            <button
              className={transformMode === "rotate" ? "active" : ""}
              type="button"
              onClick={() => setTransformMode("rotate")}
            >
              Rotate
            </button>
            <button
              className={transformMode === "scale" ? "active" : ""}
              type="button"
              onClick={() => setTransformMode("scale")}
            >
              Scale
            </button>
          </div>
          <span className="status-pill">{panoramaUrl ? "Texture loaded" : "No panorama"}</span>
        </div>
        <PanoramaViewer
          imageUrl={panoramaUrl}
          assets={assets}
          instances={instances}
          selectedInstanceId={selectedInstanceId}
          transformMode={transformMode}
          onSelectInstance={setSelectedInstanceId}
          onTransformChange={mergeInstance}
          onTransformCommit={persistInstance}
        />
      </section>
    </main>
  );
}

function NumberField({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      {label}
      <input
        min={min}
        step="0.01"
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
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

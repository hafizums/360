import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, assetUrl, Project } from "../api";
import PanoramaViewer from "../components/PanoramaViewer";
import UploadPanel from "../components/UploadPanel";

export default function ProjectEditor() {
  const params = useParams();
  const projectId = Number(params.projectId);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(projectId)) {
      setError("Invalid project id.");
      setLoading(false);
      return;
    }

    api
      .getProject(projectId)
      .then(setProject)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId]);

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

  const sourceUrl = assetUrl(project.source_image_path);
  const panoramaUrl = assetUrl(project.panorama_image_path);

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
          <span className="status-pill">{panoramaUrl ? "Texture loaded" : "No panorama"}</span>
        </div>
        <PanoramaViewer imageUrl={panoramaUrl} />
      </section>
    </main>
  );
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

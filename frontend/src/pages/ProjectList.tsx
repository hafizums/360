import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, Project } from "../api";

export default function ProjectList() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listProjects()
      .then(setProjects)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Project name is required.");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const project = await api.createProject({ name, description });
      navigate(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create project.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Personal workspace</p>
          <h1>360 Scene Stager</h1>
        </div>
        <span className="status-pill">Local only</span>
      </header>

      <section className="workspace-grid">
        <form className="panel create-panel" onSubmit={handleCreate}>
          <h2>Create project</h2>
          <label>
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Apartment concept"
            />
          </label>
          <label>
            Description
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Reference notes, location, mood, or intended scene use"
              rows={5}
            />
          </label>
          <button className="primary-button" type="submit" disabled={creating}>
            {creating ? "Creating..." : "Create and open"}
          </button>
          {error ? <p className="error-text">{error}</p> : null}
        </form>

        <section className="panel project-panel">
          <div className="panel-heading">
            <h2>Projects</h2>
            <span>{projects.length}</span>
          </div>

          {loading ? <p className="muted">Loading projects...</p> : null}

          {!loading && projects.length === 0 ? (
            <div className="empty-state">
              <h3>No projects yet</h3>
              <p>Create a project to start collecting reference images and panoramas.</p>
            </div>
          ) : null}

          <div className="project-list">
            {projects.map((project) => (
              <Link className="project-row" to={`/projects/${project.id}`} key={project.id}>
                <div>
                  <h3>{project.name}</h3>
                  <p>{project.description || "No description"}</p>
                </div>
                <div className="project-badges">
                  <span className={project.source_image_path ? "badge ok" : "badge"}>
                    Source
                  </span>
                  <span className={project.panorama_image_path ? "badge ok" : "badge"}>
                    360
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

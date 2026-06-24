import { ChangeEvent, useRef, useState } from "react";
import { Project } from "../api";

type UploadPanelProps = {
  title: string;
  helperText: string;
  buttonText: string;
  currentPath: string | null;
  onUpload: (file: File) => Promise<Project>;
  onUploaded: (project: Project) => void;
  validateFile?: (file: File) => Promise<string | null>;
};

export default function UploadPanel({
  title,
  helperText,
  buttonText,
  currentPath,
  onUpload,
  onUploaded,
  validateFile,
}: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      if (validateFile) {
        setWarning(await validateFile(file));
      }
      const project = await onUpload(file);
      onUploaded(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  return (
    <section className="panel upload-panel">
      <div className="panel-heading">
        <h2>{title}</h2>
        <span className={currentPath ? "badge ok" : "badge"}>
          {currentPath ? "Uploaded" : "Empty"}
        </span>
      </div>
      <p className="muted">{helperText}</p>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handleFileChange}
        hidden
      />
      <button
        className="secondary-button"
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? "Uploading..." : buttonText}
      </button>
      {currentPath ? <p className="file-path">{currentPath}</p> : null}
      {warning ? <p className="warning-text">{warning}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}

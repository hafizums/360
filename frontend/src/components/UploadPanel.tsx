import { ChangeEvent, useRef, useState } from "react";
import { Project } from "../api";

type UploadPanelProps = {
  title: string;
  helperText: string;
  buttonText: string;
  currentPath: string | null;
  accept?: string;
  onUpload: (file: File) => Promise<Project>;
  onUploaded: (project: Project) => void;
  validateFile?: (file: File) => Promise<string | null>;
};

export default function UploadPanel({
  title,
  helperText,
  buttonText,
  currentPath,
  accept = "image/png,image/jpeg,image/webp",
  onUpload,
  onUploaded,
  validateFile,
}: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setBusy(true);
    setError(null);
    setWarning(null);
    setStatus(null);
    try {
      if (validateFile) {
        setWarning(await validateFile(file));
      }
      const project = await onUpload(file);
      onUploaded(project);
      setStatus("Uploaded.");
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
        accept={accept}
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
      {status ? <p className="success-text">{status}</p> : null}
      {warning ? <p className="warning-text">{warning}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}

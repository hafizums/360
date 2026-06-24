export const API_BASE_URL =
  import.meta.env.VITE_API_URL?.replace(/\/$/, "") || "http://127.0.0.1:8000";

export type Project = {
  id: number;
  name: string;
  description: string;
  source_image_path: string | null;
  panorama_image_path: string | null;
  created_at: string;
  updated_at: string;
};

export type CharacterAsset = {
  id: number;
  project_id: number;
  name: string;
  model_path: string;
  created_at: string;
  updated_at: string;
};

export type CharacterInstance = {
  id: number;
  project_id: number;
  character_asset_id: number;
  name: string;
  position_x: number;
  position_y: number;
  position_z: number;
  rotation_x: number;
  rotation_y: number;
  rotation_z: number;
  scale: number;
  visible: boolean;
  created_at: string;
  updated_at: string;
};

type ProjectPayload = {
  name: string;
  description: string;
};

export type CharacterInstanceUpdate = Partial<
  Pick<
    CharacterInstance,
    | "name"
    | "position_x"
    | "position_y"
    | "position_z"
    | "rotation_x"
    | "rotation_y"
    | "rotation_z"
    | "scale"
    | "visible"
  >
>;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(formatApiError(error.detail || "Request failed"));
  }

  return response.json() as Promise<T>;
}

export function assetUrl(path: string | null): string | null {
  if (!path) {
    return null;
  }
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${API_BASE_URL}${path}`;
}

export const api = {
  listProjects: () => request<Project[]>("/api/projects"),
  createProject: (payload: ProjectPayload) =>
    request<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getProject: (id: number) => request<Project>(`/api/projects/${id}`),
  updateProject: (id: number, payload: Partial<ProjectPayload>) =>
    request<Project>(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  uploadSource: (id: number, file: File) => uploadImage(id, "upload-source", file),
  uploadPanorama: (id: number, file: File) => uploadImage(id, "upload-panorama", file),
  listCharacterAssets: (projectId: number) =>
    request<CharacterAsset[]>(`/api/projects/${projectId}/character-assets`),
  uploadCharacterAsset: (projectId: number, file: File) =>
    uploadFile<CharacterAsset>(`/api/projects/${projectId}/character-assets/upload`, file),
  deleteCharacterAsset: (projectId: number, assetId: number) =>
    request<{ deleted: boolean }>(`/api/projects/${projectId}/character-assets/${assetId}`, {
      method: "DELETE",
    }),
  listCharacterInstances: (projectId: number) =>
    request<CharacterInstance[]>(`/api/projects/${projectId}/character-instances`),
  createCharacterInstance: (projectId: number, characterAssetId: number) =>
    request<CharacterInstance>(`/api/projects/${projectId}/character-instances`, {
      method: "POST",
      body: JSON.stringify({ character_asset_id: characterAssetId }),
    }),
  updateCharacterInstance: (
    projectId: number,
    instanceId: number,
    payload: CharacterInstanceUpdate,
  ) =>
    request<CharacterInstance>(
      `/api/projects/${projectId}/character-instances/${instanceId}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
    ),
  deleteCharacterInstance: (projectId: number, instanceId: number) =>
    request<{ deleted: boolean }>(
      `/api/projects/${projectId}/character-instances/${instanceId}`,
      { method: "DELETE" },
    ),
  duplicateCharacterInstance: (projectId: number, instanceId: number) =>
    request<CharacterInstance>(
      `/api/projects/${projectId}/character-instances/${instanceId}/duplicate`,
      { method: "POST" },
    ),
};

async function uploadImage(id: number, endpoint: string, file: File): Promise<Project> {
  return uploadFile<Project>(`/api/projects/${id}/${endpoint}`, file);
}

async function uploadFile<T>(path: string, file: File): Promise<T> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(formatApiError(error.detail || "Upload failed"));
  }

  return response.json() as Promise<T>;
}

function formatApiError(detail: unknown): string {
  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object" && "msg" in item) {
          return String(item.msg).replace(/^Value error,\s*/i, "");
        }
        return "Request failed";
      })
      .join(" ");
  }

  return "Request failed";
}

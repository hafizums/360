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
  scene_state_id: number;
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

export type SceneState = {
  id: number;
  project_id: number;
  name: string;
  description: string;
  sort_order: number;
  shot_number: number;
  shot_size: ShotSize;
  camera_move: CameraMove;
  action_notes: string;
  prompt_notes: string;
  camera_position_x: number;
  camera_position_y: number;
  camera_position_z: number;
  camera_target_x: number;
  camera_target_y: number;
  camera_target_z: number;
  camera_fov: number;
  created_at: string;
  updated_at: string;
};

export type ShotSize = "WIDE" | "MS" | "CU" | "ECU";
export type CameraMove =
  | "static"
  | "push"
  | "pull"
  | "pan"
  | "tilt"
  | "handheld"
  | "orbit"
  | "dolly"
  | "zoom";

export type CameraSnapshot = {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  fov: number;
};

type ProjectPayload = {
  name: string;
  description: string;
};

export type SceneStatePayload = {
  name: string;
  description: string;
};

export type SceneStateUpdate = Partial<
  Pick<
    SceneState,
    | "name"
    | "description"
    | "shot_number"
    | "shot_size"
    | "camera_move"
    | "action_notes"
    | "prompt_notes"
    | "camera_position_x"
    | "camera_position_y"
    | "camera_position_z"
    | "camera_target_x"
    | "camera_target_y"
    | "camera_target_z"
    | "camera_fov"
  >
>;

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
  listCharacterInstances: (projectId: number, sceneStateId?: number) => {
    const query = sceneStateId ? `?scene_state_id=${sceneStateId}` : "";
    return request<CharacterInstance[]>(
      `/api/projects/${projectId}/character-instances${query}`,
    );
  },
  createCharacterInstance: (
    projectId: number,
    characterAssetId: number,
    sceneStateId?: number,
  ) =>
    request<CharacterInstance>(`/api/projects/${projectId}/character-instances`, {
      method: "POST",
      body: JSON.stringify({
        character_asset_id: characterAssetId,
        ...(sceneStateId ? { scene_state_id: sceneStateId } : {}),
      }),
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
  listSceneStates: (projectId: number) =>
    request<SceneState[]>(`/api/projects/${projectId}/scene-states`),
  createSceneState: (projectId: number, payload: SceneStatePayload) =>
    request<SceneState>(`/api/projects/${projectId}/scene-states`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateSceneState: (
    projectId: number,
    sceneStateId: number,
    payload: SceneStateUpdate,
  ) =>
    request<SceneState>(`/api/projects/${projectId}/scene-states/${sceneStateId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteSceneState: (projectId: number, sceneStateId: number) =>
    request<{ deleted: boolean }>(`/api/projects/${projectId}/scene-states/${sceneStateId}`, {
      method: "DELETE",
    }),
  duplicateSceneState: (projectId: number, sceneStateId: number) =>
    request<SceneState>(`/api/projects/${projectId}/scene-states/${sceneStateId}/duplicate`, {
      method: "POST",
    }),
  exportSceneJson: (projectId: number, sceneStateId: number) =>
    request<Record<string, unknown>>(
      `/api/projects/${projectId}/scene-states/${sceneStateId}/export-json`,
    ),
  downloadProjectPackage: async (projectId: number) => {
    const response = await fetch(`${API_BASE_URL}/api/projects/${projectId}/export-package`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(formatApiError(error.detail || "Package export failed."));
    }
    return response.blob();
  },
  exportProjectPackageUrl: (projectId: number) =>
    `${API_BASE_URL}/api/projects/${projectId}/export-package`,
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

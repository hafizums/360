from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

ALLOWED_SHOT_SIZES = {"WIDE", "MS", "CU", "ECU"}
ALLOWED_CAMERA_MOVES = {
    "static",
    "push",
    "pull",
    "pan",
    "tilt",
    "handheld",
    "orbit",
    "dolly",
    "zoom",
}


def clean_project_name(value: str) -> str:
    stripped = value.strip()
    if not stripped:
        raise ValueError("Project name is required.")
    return stripped


class ProjectBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""

    @field_validator("name", mode="before")
    @classmethod
    def strip_and_validate_name(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("Project name must be text.")
        return clean_project_name(value)


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None

    @field_validator("name", mode="before")
    @classmethod
    def strip_and_validate_optional_name(cls, value: str | None) -> str | None:
        if value is None:
            raise ValueError("Project name is required.")
        if not isinstance(value, str):
            raise ValueError("Project name must be text.")
        return clean_project_name(value)

    @field_validator("description", mode="before")
    @classmethod
    def validate_optional_description(cls, value: str | None) -> str | None:
        if value is None:
            raise ValueError("Project description must be text.")
        if not isinstance(value, str):
            raise ValueError("Project description must be text.")
        return value


class Project(ProjectBase):
    id: int
    source_image_path: str | None = None
    panorama_image_path: str | None = None
    created_at: datetime
    updated_at: datetime


def clean_character_name(value: str, label: str = "Character name") -> str:
    stripped = value.strip()
    if not stripped:
        raise ValueError(f"{label} is required.")
    return stripped


class CharacterAsset(BaseModel):
    id: int
    project_id: int
    name: str
    model_path: str
    created_at: datetime
    updated_at: datetime


class CharacterInstanceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    character_asset_id: int
    scene_state_id: int | None = None
    name: str | None = Field(default=None, max_length=120)

    @field_validator("name", mode="before")
    @classmethod
    def strip_optional_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("Character name must be text.")
        return clean_character_name(value)


class CharacterInstanceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=120)
    position_x: float | None = None
    position_y: float | None = None
    position_z: float | None = None
    rotation_x: float | None = None
    rotation_y: float | None = None
    rotation_z: float | None = None
    scale: float | None = Field(default=None, gt=0)
    visible: bool | None = None

    @field_validator("name", mode="before")
    @classmethod
    def strip_optional_update_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("Character name must be text.")
        return clean_character_name(value)


class CharacterInstance(BaseModel):
    id: int
    project_id: int
    scene_state_id: int
    character_asset_id: int
    name: str
    position_x: float
    position_y: float
    position_z: float
    rotation_x: float
    rotation_y: float
    rotation_z: float
    scale: float
    visible: bool
    created_at: datetime
    updated_at: datetime


def clean_scene_state_name(value: str) -> str:
    stripped = value.strip()
    if not stripped:
        raise ValueError("Scene state name is required.")
    return stripped


class SceneStateCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    shot_number: int = Field(default=1, ge=1)
    shot_size: str = "WIDE"
    camera_move: str = "static"
    action_notes: str = ""
    prompt_notes: str = ""
    camera_position_x: float = 0
    camera_position_y: float = 1.4
    camera_position_z: float = 0.2
    camera_target_x: float = 0
    camera_target_y: float = 1.4
    camera_target_z: float = -2
    camera_fov: float = Field(default=75, ge=20, le=120)

    @field_validator("name", mode="before")
    @classmethod
    def strip_and_validate_name(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("Scene state name must be text.")
        return clean_scene_state_name(value)

    @field_validator("description", mode="before")
    @classmethod
    def validate_description(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("Scene state description must be text.")
        return value.strip()

    @field_validator("shot_size", mode="before")
    @classmethod
    def validate_shot_size(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("Shot size must be text.")
        normalized = value.strip().upper()
        if normalized not in ALLOWED_SHOT_SIZES:
            raise ValueError("Shot size must be one of WIDE, MS, CU, or ECU.")
        return normalized

    @field_validator("camera_move", mode="before")
    @classmethod
    def validate_camera_move(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("Camera move must be text.")
        normalized = value.strip().lower()
        if normalized not in ALLOWED_CAMERA_MOVES:
            raise ValueError("Camera move is not supported.")
        return normalized

    @field_validator("action_notes", "prompt_notes", mode="before")
    @classmethod
    def strip_text_fields(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("Scene state text fields must be text.")
        return value.strip()


class SceneStateUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    sort_order: int | None = None
    shot_number: int | None = Field(default=None, ge=1)
    shot_size: str | None = None
    camera_move: str | None = None
    action_notes: str | None = None
    prompt_notes: str | None = None
    camera_position_x: float | None = None
    camera_position_y: float | None = None
    camera_position_z: float | None = None
    camera_target_x: float | None = None
    camera_target_y: float | None = None
    camera_target_z: float | None = None
    camera_fov: float | None = Field(default=None, ge=20, le=120)

    @field_validator("name", mode="before")
    @classmethod
    def strip_and_validate_optional_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("Scene state name must be text.")
        return clean_scene_state_name(value)

    @field_validator("description", mode="before")
    @classmethod
    def validate_optional_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("Scene state description must be text.")
        return value.strip()

    @field_validator("shot_size", mode="before")
    @classmethod
    def validate_optional_shot_size(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return SceneStateCreate.validate_shot_size(value)

    @field_validator("camera_move", mode="before")
    @classmethod
    def validate_optional_camera_move(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return SceneStateCreate.validate_camera_move(value)

    @field_validator("action_notes", "prompt_notes", mode="before")
    @classmethod
    def strip_optional_text_fields(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("Scene state text fields must be text.")
        return value.strip()


class SceneState(BaseModel):
    id: int
    project_id: int
    name: str
    description: str
    sort_order: int
    shot_number: int
    shot_size: str
    camera_move: str
    action_notes: str
    prompt_notes: str
    camera_position_x: float
    camera_position_y: float
    camera_position_z: float
    camera_target_x: float
    camera_target_y: float
    camera_target_z: float
    camera_fov: float
    created_at: datetime
    updated_at: datetime

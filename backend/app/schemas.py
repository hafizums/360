from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


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
        return value


class SceneStateUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    sort_order: int | None = None

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
        return value


class SceneState(BaseModel):
    id: int
    project_id: int
    name: str
    description: str
    sort_order: int
    created_at: datetime
    updated_at: datetime

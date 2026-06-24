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

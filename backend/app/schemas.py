from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class ProjectBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    source_image_path: str | None = None
    panorama_image_path: str | None = None


class Project(ProjectBase):
    id: int
    source_image_path: str | None = None
    panorama_image_path: str | None = None
    created_at: datetime
    updated_at: datetime

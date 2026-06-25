from __future__ import annotations

import json
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, StreamingResponse

from app.exports import build_project_export, build_scene_export

router = APIRouter(prefix="/api/projects/{project_id}", tags=["exports"])


@router.get("/scene-states/{scene_state_id}/export-json")
def export_scene_json(project_id: int, scene_state_id: int) -> dict:
    payload = build_scene_export(project_id, scene_state_id)
    if not payload:
        raise HTTPException(status_code=404, detail="Scene state not found")
    return payload


@router.get("/export-package")
def export_project_package(project_id: int) -> Response:
    payload = build_project_export(project_id)
    if not payload:
        raise HTTPException(status_code=404, detail="Project not found")

    buffer = BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as archive:
        archive.writestr("project.json", json.dumps(payload["project"], indent=2))
        archive.writestr(
            "environment_variants.json",
            json.dumps(payload["environment_variants"], indent=2),
        )
        archive.writestr("scene_states.json", json.dumps(payload["scene_states"], indent=2))
        archive.writestr(
            "character_assets.json",
            json.dumps(payload["character_assets"], indent=2),
        )
        archive.writestr(
            "character_instances.json",
            json.dumps(payload["character_instances"], indent=2),
        )
        prompt_lines = []
        for item in payload["prompts_by_scene"]:
            prompt_lines.append(f"# {item['scene_state_name']} (id {item['scene_state_id']})")
            prompts = item["prompts"]
            prompt_lines.append("\nImage reference prompt:")
            prompt_lines.append(prompts["image_reference_prompt"])
            prompt_lines.append("\nVideo prompt:")
            prompt_lines.append(prompts["video_prompt"])
            prompt_lines.append("\nNegative / consistency prompt:")
            prompt_lines.append(prompts["negative_consistency_prompt"])
            prompt_lines.append("\nCharacter placement summary:")
            prompt_lines.append(prompts["character_placement_summary"])
            prompt_lines.append("\n")
        archive.writestr("prompts.txt", "\n".join(prompt_lines))

    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="project-{project_id}-export.zip"'
        },
    )

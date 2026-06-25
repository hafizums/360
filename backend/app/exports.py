from __future__ import annotations

from datetime import datetime, timezone

from app.database import db_session
from app.models import (
    character_asset_from_row,
    character_instance_from_row,
    environment_variant_from_row,
    project_from_row,
    scene_state_from_row,
)


def build_character_summary(instances: list[dict]) -> str:
    if not instances:
        return "No characters placed."
    return "; ".join(
        (
            f"{instance['name']} ({'visible' if instance['visible'] else 'hidden'}) at "
            f"({instance['position_x']:.2f}, {instance['position_y']:.2f}, {instance['position_z']:.2f}), "
            f"rotation ({instance['rotation_x']:.2f}, {instance['rotation_y']:.2f}, {instance['rotation_z']:.2f}) radians, "
            f"scale {instance['scale']:.2f}"
        )
        for instance in instances
    )


def calibration_from_environment(environment_variant: dict | None) -> dict[str, float | int | str] | None:
    if environment_variant is None:
        return None
    return {
        "horizon_y": environment_variant["horizon_y"],
        "floor_y": environment_variant["floor_y"],
        "floor_grid_size": environment_variant["floor_grid_size"],
        "floor_grid_divisions": environment_variant["floor_grid_divisions"],
        "placement_radius": environment_variant["placement_radius"],
        "default_character_scale": environment_variant["default_character_scale"],
        "camera_height": environment_variant["camera_height"],
        "calibration_notes": environment_variant["calibration_notes"],
    }


def build_calibration_summary(environment_variant: dict | None) -> str:
    if environment_variant is None:
        return "No active environment calibration saved."
    return (
        f"Environment calibration: horizon Y {environment_variant['horizon_y']:.2f}, "
        f"floor Y {environment_variant['floor_y']:.2f}, "
        f"placement radius {environment_variant['placement_radius']:.2f}, "
        f"default character scale {environment_variant['default_character_scale']:.2f}, "
        f"camera height {environment_variant['camera_height']:.2f}. "
        f"Notes: {environment_variant['calibration_notes'] or 'No calibration notes.'}"
    )


def build_prompts(
    project: dict,
    scene_state: dict,
    instances: list[dict],
    active_environment_variant: dict | None = None,
) -> dict[str, str]:
    character_summary = build_character_summary(instances)
    calibration_summary = build_calibration_summary(active_environment_variant)
    description = scene_state["description"] or "No scene description provided."
    image_prompt = (
        f"Create a cinematic {scene_state['shot_size']} frame inside the provided 360 environment. "
        f"Project: {project['name']}. Shot {scene_state['shot_number']}: {scene_state['name']}. "
        f"Scene description: {description}. Shot size: {scene_state['shot_size']}. "
        f"Camera move: {scene_state['camera_move']}. Camera: FOV {scene_state['camera_fov']:.1f}. "
        f"{calibration_summary} "
        f"Characters: {character_summary}. "
        f"Action: {scene_state['action_notes'] or 'No action notes provided.'}. "
        f"Style/notes: {scene_state['prompt_notes'] or 'No extra style notes provided.'}. "
        "Keep character identity and placement consistent with the reference layout."
    )
    video_prompt = (
        f"Generate a short cinematic video for shot {scene_state['shot_number']}: {scene_state['name']}. "
        f"Camera move: {scene_state['camera_move']}. Shot size: {scene_state['shot_size']}. "
        f"Scene description: {description}. "
        f"{calibration_summary} "
        f"Character blocking: {character_summary}. "
        f"Action: {scene_state['action_notes'] or 'No action notes provided.'}. "
        "Preserve the same 360 environment, character positions, scale, and orientation unless the action notes specify movement."
    )
    negative_prompt = (
        "Avoid changing character identity, wardrobe, relative scale, or established placement. "
        "Avoid adding unlisted characters, changing the room layout, distorting anatomy, or drifting away from the saved camera framing."
    )
    return {
        "image_reference_prompt": image_prompt,
        "video_prompt": video_prompt,
        "negative_consistency_prompt": negative_prompt,
        "character_placement_summary": character_summary,
        "environment_calibration_summary": calibration_summary,
    }


def build_scene_export(project_id: int, scene_state_id: int) -> dict:
    with db_session() as conn:
        project_row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        scene_row = conn.execute(
            "SELECT * FROM scene_states WHERE id = ? AND project_id = ?",
            (scene_state_id, project_id),
        ).fetchone()
        if project_row is None or scene_row is None:
            return {}

        instance_rows = conn.execute(
            """
            SELECT * FROM character_instances
            WHERE project_id = ? AND scene_state_id = ?
            ORDER BY id ASC
            """,
            (project_id, scene_state_id),
        ).fetchall()
        environment_rows = conn.execute(
            """
            SELECT * FROM environment_variants
            WHERE project_id = ?
            ORDER BY is_active DESC, updated_at DESC, id DESC
            """,
            (project_id,),
        ).fetchall()
        instances = [character_instance_from_row(row) for row in instance_rows]
        asset_ids = sorted({instance["character_asset_id"] for instance in instances})
        if asset_ids:
            placeholders = ",".join("?" for _ in asset_ids)
            asset_rows = conn.execute(
                f"""
                SELECT * FROM character_assets
                WHERE project_id = ? AND id IN ({placeholders})
                ORDER BY id ASC
                """,
                (project_id, *asset_ids),
            ).fetchall()
        else:
            asset_rows = []

    project = project_from_row(project_row)
    scene_state = scene_state_from_row(scene_row)
    assets = [character_asset_from_row(row) for row in asset_rows]
    environment_variants = [environment_variant_from_row(row) for row in environment_rows]
    active_environment_variant = next(
        (variant for variant in environment_variants if variant["is_active"]),
        None,
    )
    prompts = build_prompts(project, scene_state, instances, active_environment_variant)
    environment_calibration = calibration_from_environment(active_environment_variant)

    return {
        "project": project,
        "panorama_path": project["panorama_image_path"],
        "source_image_path": project["source_image_path"],
        "environment_variants": environment_variants,
        "active_environment_variant": active_environment_variant,
        "environment_calibration": environment_calibration,
        "scene_state": scene_state,
        "camera": {
            "position": {
                "x": scene_state["camera_position_x"],
                "y": scene_state["camera_position_y"],
                "z": scene_state["camera_position_z"],
            },
            "target": {
                "x": scene_state["camera_target_x"],
                "y": scene_state["camera_target_y"],
                "z": scene_state["camera_target_z"],
            },
            "fov": scene_state["camera_fov"],
        },
        "character_assets": assets,
        "character_instances": instances,
        "coordinate_convention": {
            "up_axis": "y",
            "floor_y": environment_calibration["floor_y"] if environment_calibration else 0,
            "placement_radius": (
                environment_calibration["placement_radius"] if environment_calibration else 2
            ),
            "rotation_units": "radians",
            "scale": "uniform scalar",
        },
        "prompts": prompts,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def build_project_export(project_id: int) -> dict:
    with db_session() as conn:
        project_row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if project_row is None:
            return {}
        scene_rows = conn.execute(
            "SELECT * FROM scene_states WHERE project_id = ? ORDER BY sort_order ASC, id ASC",
            (project_id,),
        ).fetchall()
        asset_rows = conn.execute(
            "SELECT * FROM character_assets WHERE project_id = ? ORDER BY id ASC",
            (project_id,),
        ).fetchall()
        instance_rows = conn.execute(
            "SELECT * FROM character_instances WHERE project_id = ? ORDER BY scene_state_id ASC, id ASC",
            (project_id,),
        ).fetchall()
        environment_rows = conn.execute(
            """
            SELECT * FROM environment_variants
            WHERE project_id = ?
            ORDER BY is_active DESC, updated_at DESC, id DESC
            """,
            (project_id,),
        ).fetchall()

    project = project_from_row(project_row)
    scene_states = [scene_state_from_row(row) for row in scene_rows]
    assets = [character_asset_from_row(row) for row in asset_rows]
    instances = [character_instance_from_row(row) for row in instance_rows]
    environment_variants = [environment_variant_from_row(row) for row in environment_rows]
    active_environment_variant = next(
        (variant for variant in environment_variants if variant["is_active"]),
        None,
    )
    prompts_by_scene = []
    for scene_state in scene_states:
        scene_instances = [
            instance for instance in instances if instance["scene_state_id"] == scene_state["id"]
        ]
        prompts_by_scene.append(
            {
                "scene_state_id": scene_state["id"],
                "scene_state_name": scene_state["name"],
                "prompts": build_prompts(
                    project,
                    scene_state,
                    scene_instances,
                    active_environment_variant,
                ),
            }
        )

    return {
        "project": project,
        "scene_states": scene_states,
        "environment_variants": environment_variants,
        "active_environment_variant": active_environment_variant,
        "environment_calibration": calibration_from_environment(active_environment_variant),
        "character_assets": assets,
        "character_instances": instances,
        "prompts_by_scene": prompts_by_scene,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

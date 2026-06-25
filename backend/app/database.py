from __future__ import annotations

from contextlib import contextmanager
import sqlite3
from collections.abc import Iterator

from app.config import get_database_path


def get_connection() -> sqlite3.Connection:
    db_path = get_database_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def db_session() -> Iterator[sqlite3.Connection]:
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with db_session() as conn:
        conn.execute("DROP TRIGGER IF EXISTS projects_updated_at")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                source_image_path TEXT,
                panorama_image_path TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS scene_states (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS character_assets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                model_path TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS character_instances (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                character_asset_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                position_x REAL NOT NULL DEFAULT 0,
                position_y REAL NOT NULL DEFAULT 0,
                position_z REAL NOT NULL DEFAULT -2,
                rotation_x REAL NOT NULL DEFAULT 0,
                rotation_y REAL NOT NULL DEFAULT 0,
                rotation_z REAL NOT NULL DEFAULT 0,
                scale REAL NOT NULL DEFAULT 1,
                visible INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY (character_asset_id) REFERENCES character_assets(id) ON DELETE RESTRICT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS environment_variants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                source_image_path TEXT,
                panorama_image_path TEXT,
                status TEXT NOT NULL DEFAULT 'draft',
                generator TEXT NOT NULL DEFAULT 'manual',
                source_prompt TEXT NOT NULL DEFAULT '',
                panorama_prompt TEXT NOT NULL DEFAULT '',
                negative_prompt TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                width INTEGER NOT NULL DEFAULT 4096,
                height INTEGER NOT NULL DEFAULT 2048,
                horizon_y REAL NOT NULL DEFAULT 0.5,
                floor_y REAL NOT NULL DEFAULT 0,
                floor_grid_size REAL NOT NULL DEFAULT 16,
                floor_grid_divisions INTEGER NOT NULL DEFAULT 16,
                placement_radius REAL NOT NULL DEFAULT 3,
                default_character_scale REAL NOT NULL DEFAULT 1,
                camera_height REAL NOT NULL DEFAULT 1.4,
                calibration_notes TEXT NOT NULL DEFAULT '',
                is_active INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            )
            """
        )
        add_column_if_missing(conn, "character_instances", "scene_state_id", "INTEGER")
        add_column_if_missing(conn, "scene_states", "shot_number", "INTEGER NOT NULL DEFAULT 1")
        add_column_if_missing(conn, "scene_states", "shot_size", "TEXT NOT NULL DEFAULT 'WIDE'")
        add_column_if_missing(conn, "scene_states", "camera_move", "TEXT NOT NULL DEFAULT 'static'")
        add_column_if_missing(conn, "scene_states", "action_notes", "TEXT NOT NULL DEFAULT ''")
        add_column_if_missing(conn, "scene_states", "prompt_notes", "TEXT NOT NULL DEFAULT ''")
        add_column_if_missing(conn, "scene_states", "camera_position_x", "REAL NOT NULL DEFAULT 0")
        add_column_if_missing(conn, "scene_states", "camera_position_y", "REAL NOT NULL DEFAULT 1.4")
        add_column_if_missing(conn, "scene_states", "camera_position_z", "REAL NOT NULL DEFAULT 0.2")
        add_column_if_missing(conn, "scene_states", "camera_target_x", "REAL NOT NULL DEFAULT 0")
        add_column_if_missing(conn, "scene_states", "camera_target_y", "REAL NOT NULL DEFAULT 1.4")
        add_column_if_missing(conn, "scene_states", "camera_target_z", "REAL NOT NULL DEFAULT -2")
        add_column_if_missing(conn, "scene_states", "camera_fov", "REAL NOT NULL DEFAULT 75")
        add_column_if_missing(conn, "environment_variants", "horizon_y", "REAL NOT NULL DEFAULT 0.5")
        add_column_if_missing(conn, "environment_variants", "floor_y", "REAL NOT NULL DEFAULT 0")
        add_column_if_missing(conn, "environment_variants", "floor_grid_size", "REAL NOT NULL DEFAULT 16")
        add_column_if_missing(
            conn,
            "environment_variants",
            "floor_grid_divisions",
            "INTEGER NOT NULL DEFAULT 16",
        )
        add_column_if_missing(
            conn,
            "environment_variants",
            "placement_radius",
            "REAL NOT NULL DEFAULT 3",
        )
        add_column_if_missing(
            conn,
            "environment_variants",
            "default_character_scale",
            "REAL NOT NULL DEFAULT 1",
        )
        add_column_if_missing(
            conn,
            "environment_variants",
            "camera_height",
            "REAL NOT NULL DEFAULT 1.4",
        )
        add_column_if_missing(
            conn,
            "environment_variants",
            "calibration_notes",
            "TEXT NOT NULL DEFAULT ''",
        )
        ensure_default_scene_states(conn)
        ensure_default_environment_variants(conn)


def add_column_if_missing(
    conn: sqlite3.Connection,
    table_name: str,
    column_name: str,
    column_definition: str,
) -> None:
    columns = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    if column_name not in {column["name"] for column in columns}:
        conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}")


def ensure_default_scene_states(conn: sqlite3.Connection) -> None:
    projects = conn.execute("SELECT id FROM projects").fetchall()
    for project in projects:
        default_id = get_default_scene_state_id(conn, project["id"], create=True)
        conn.execute(
            """
            UPDATE character_instances
            SET scene_state_id = ?
            WHERE project_id = ? AND scene_state_id IS NULL
            """,
            (default_id, project["id"]),
        )


def ensure_default_environment_variants(conn: sqlite3.Connection) -> None:
    projects = conn.execute(
        """
        SELECT id, source_image_path, panorama_image_path
        FROM projects
        WHERE source_image_path IS NOT NULL OR panorama_image_path IS NOT NULL
        """
    ).fetchall()
    for project in projects:
        existing = conn.execute(
            "SELECT id FROM environment_variants WHERE project_id = ? LIMIT 1",
            (project["id"],),
        ).fetchone()
        if existing is not None:
            continue

        status = "active" if project["panorama_image_path"] else "draft"
        conn.execute(
            """
            INSERT INTO environment_variants (
                project_id,
                name,
                source_image_path,
                panorama_image_path,
                status,
                is_active
            )
            VALUES (?, 'Base Environment', ?, ?, ?, ?)
            """,
            (
                project["id"],
                project["source_image_path"],
                project["panorama_image_path"],
                status,
                1 if project["panorama_image_path"] else 0,
            ),
        )


def get_default_scene_state_id(
    conn: sqlite3.Connection,
    project_id: int,
    create: bool = True,
) -> int | None:
    row = conn.execute(
        """
        SELECT id FROM scene_states
        WHERE project_id = ?
        ORDER BY sort_order ASC, id ASC
        LIMIT 1
        """,
        (project_id,),
    ).fetchone()
    if row is not None:
        return row["id"]

    if not create:
        return None

    cursor = conn.execute(
        """
        INSERT INTO scene_states (project_id, name, sort_order)
        VALUES (?, 'Base Scene', 0)
        """,
        (project_id,),
    )
    return cursor.lastrowid

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
        add_column_if_missing(conn, "character_instances", "scene_state_id", "INTEGER")
        ensure_default_scene_states(conn)


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

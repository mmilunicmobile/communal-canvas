import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from constants import DEFAULT_PERMISSION_SETTINGS
from contextlib import contextmanager

DB_PATH = Path(__file__).resolve().parent / "canvaslights.db"


@contextmanager
def get_connection():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
    finally:
        connection.close()


def init_db():
    with get_connection() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS images (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                original_name TEXT NOT NULL,
                type TEXT NOT NULL,
                uploaded_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS permission_settings (
                feature TEXT PRIMARY KEY,
                requires_passkey INTEGER NOT NULL
            )
            """
        )
        connection.executemany(
            """
            INSERT OR IGNORE INTO permission_settings (feature, requires_passkey)
            VALUES (?, ?)
            """,
            [
                (feature, int(requires_passkey))
                for feature, requires_passkey in DEFAULT_PERMISSION_SETTINGS.items()
            ],
        )


def _row_to_dict(row):
    return {
        "id": row["id"],
        "filename": row["filename"],
        "original_name": row["original_name"],
        "type": row["type"],
        "uploaded_at": row["uploaded_at"],
    }


def list_images():
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM images ORDER BY uploaded_at DESC, id DESC"
        ).fetchall()
    return [_row_to_dict(row) for row in rows]


def create_image(filename, original_name, image_type):
    uploaded_at = datetime.now(timezone.utc).isoformat()
    with get_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO images (filename, original_name, type, uploaded_at)
            VALUES (?, ?, ?, ?)
            """,
            (filename, original_name, image_type, uploaded_at),
        )
        row = connection.execute(
            "SELECT * FROM images WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
    return _row_to_dict(row)


def get_image(image_id):
    with get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM images WHERE id = ?", (image_id,)
        ).fetchone()
    return _row_to_dict(row) if row else None


def delete_image(image_id):
    with get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM images WHERE id = ?", (image_id,)
        ).fetchone()
        if row is None:
            return None
        connection.execute("DELETE FROM images WHERE id = ?", (image_id,))
    return _row_to_dict(row)


def db_path():
    return os.path.abspath(DB_PATH)


def list_permission_settings():
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT feature, requires_passkey FROM permission_settings"
        ).fetchall()

    settings = DEFAULT_PERMISSION_SETTINGS.copy()
    settings.update({row["feature"]: bool(row["requires_passkey"]) for row in rows})
    return settings


def update_permission_settings(settings):
    allowed_features = set(DEFAULT_PERMISSION_SETTINGS)
    unknown_features = set(settings) - allowed_features
    if unknown_features:
        raise ValueError(f"Unknown permission feature: {', '.join(sorted(unknown_features))}")

    with get_connection() as connection:
        connection.executemany(
            """
            INSERT INTO permission_settings (feature, requires_passkey)
            VALUES (?, ?)
            ON CONFLICT(feature) DO UPDATE SET requires_passkey = excluded.requires_passkey
            """,
            [(feature, int(bool(requires_passkey))) for feature, requires_passkey in settings.items()],
        )

    return list_permission_settings()

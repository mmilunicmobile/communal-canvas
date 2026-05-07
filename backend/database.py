import os
import sqlite3
from datetime import datetime, timezone

from config import DB_PATH


def get_connection():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db():
    with get_connection() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS images (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                original_name TEXT NOT NULL,
                type TEXT NOT NULL,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                uploaded_at TEXT NOT NULL
            )
            """
        )


def row_to_dict(row):
    return {
        "id": row["id"],
        "filename": row["filename"],
        "original_name": row["original_name"],
        "type": row["type"],
        "width": row["width"],
        "height": row["height"],
        "uploaded_at": row["uploaded_at"],
    }


def list_images():
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM images ORDER BY uploaded_at DESC, id DESC"
        ).fetchall()
    return [row_to_dict(row) for row in rows]


def create_image(filename, original_name, image_type, width, height):
    uploaded_at = datetime.now(timezone.utc).isoformat()
    with get_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO images (filename, original_name, type, width, height, uploaded_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (filename, original_name, image_type, width, height, uploaded_at),
        )
        row = connection.execute(
            "SELECT * FROM images WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
    return row_to_dict(row)


def get_image(image_id):
    with get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM images WHERE id = ?", (image_id,)
        ).fetchone()
    return row_to_dict(row) if row else None


def delete_image(image_id):
    with get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM images WHERE id = ?", (image_id,)
        ).fetchone()
        if row is None:
            return None
        connection.execute("DELETE FROM images WHERE id = ?", (image_id,))
    return row_to_dict(row)


def db_path():
    return os.path.abspath(DB_PATH)

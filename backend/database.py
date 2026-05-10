import os
import sqlite3
from datetime import datetime, timezone


def get_connection():
    connection = sqlite3.connect("canvaslights.db")
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
                uploaded_at TEXT NOT NULL
            )
            """
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
    return os.path.abspath("canvaslights.db")

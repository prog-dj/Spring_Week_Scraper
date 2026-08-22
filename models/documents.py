"""Document metadata only -- actual file bytes stay client-side (IndexedDB) for now.
See the pre-production plan's Phase 2 note: server-side file storage (e.g. an
S3-compatible bucket) is separate, deferred scope."""
from __future__ import annotations

from models.db import db_connect, db_lock
from models.opportunities import utc_now


def list_documents(user_id: int) -> list[dict]:
    with db_lock, db_connect() as connection:
        rows = connection.execute("SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC", (user_id,)).fetchall()
    return [dict(row) for row in rows]


def create_document(user_id: int, name: str, doc_type: str, size_bytes: int | None, status: str | None) -> dict:
    now = utc_now()
    with db_lock, db_connect() as connection:
        cursor = connection.execute(
            "INSERT INTO documents (user_id, name, doc_type, size_bytes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (user_id, name, doc_type, size_bytes, status, now, now),
        )
        row = connection.execute("SELECT * FROM documents WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return dict(row)


def delete_document(user_id: int, document_id: int) -> None:
    with db_lock, db_connect() as connection:
        connection.execute("DELETE FROM documents WHERE user_id = ? AND id = ?", (user_id, document_id))

from __future__ import annotations

from models.db import db_connect, db_lock
from models.opportunities import utc_now

VALID_STATUSES = ("Saved", "To apply", "In progress", "Submitted")


def list_applications(user_id: int) -> list[dict]:
    with db_lock, db_connect() as connection:
        rows = connection.execute(
            "SELECT a.*, o.company, o.programme, o.opportunity_url, o.deadline, o.status AS opportunity_status "
            "FROM applications a JOIN opportunities o ON o.id = a.opportunity_id "
            "WHERE a.user_id = ? ORDER BY a.updated_at DESC",
            (user_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def upsert_application(user_id: int, opportunity_id: str, status: str = "Saved", next_action: str | None = None, progress: int = 0) -> dict:
    if status not in VALID_STATUSES:
        raise ValueError(f"invalid status: {status}")
    now = utc_now()
    with db_lock, db_connect() as connection:
        connection.execute(
            "INSERT INTO applications (user_id, opportunity_id, status, next_action, progress, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(user_id, opportunity_id) DO UPDATE SET status=excluded.status, next_action=excluded.next_action, progress=excluded.progress, updated_at=excluded.updated_at",
            (user_id, opportunity_id, status, next_action, progress, now, now),
        )
        row = connection.execute("SELECT * FROM applications WHERE user_id = ? AND opportunity_id = ?", (user_id, opportunity_id)).fetchone()
    return dict(row)


def delete_application(user_id: int, opportunity_id: str) -> None:
    with db_lock, db_connect() as connection:
        connection.execute("DELETE FROM applications WHERE user_id = ? AND opportunity_id = ?", (user_id, opportunity_id))

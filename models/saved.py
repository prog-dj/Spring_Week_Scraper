from __future__ import annotations

from models.db import db_connect, db_lock
from models.opportunities import utc_now


def list_saved(user_id: int) -> list[str]:
    with db_lock, db_connect() as connection:
        rows = connection.execute("SELECT opportunity_id FROM saved_opportunities WHERE user_id = ?", (user_id,)).fetchall()
    return [row["opportunity_id"] for row in rows]


def add_saved(user_id: int, opportunity_id: str) -> None:
    with db_lock, db_connect() as connection:
        connection.execute(
            "INSERT OR IGNORE INTO saved_opportunities (user_id, opportunity_id, created_at) VALUES (?, ?, ?)",
            (user_id, opportunity_id, utc_now()),
        )


def remove_saved(user_id: int, opportunity_id: str) -> None:
    with db_lock, db_connect() as connection:
        connection.execute("DELETE FROM saved_opportunities WHERE user_id = ? AND opportunity_id = ?", (user_id, opportunity_id))

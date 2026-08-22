from __future__ import annotations

import os

from models.db import db_connect, db_lock
from models.opportunities import utc_now


def _admin_emails() -> set[str]:
    raw = os.getenv("ADMIN_EMAILS", "")
    return {email.strip().lower() for email in raw.split(",") if email.strip()}


def get_or_create_user_from_google_profile(google_sub: str, email: str, name: str | None, avatar_url: str | None) -> dict:
    """Upsert on google_sub (Google's stable user id), not email -- email can
    theoretically change on the Google account, sub cannot."""
    now = utc_now()
    is_admin = 1 if email.lower() in _admin_emails() else 0
    with db_lock, db_connect() as connection:
        existing = connection.execute("SELECT * FROM users WHERE google_sub = ?", (google_sub,)).fetchone()
        if existing:
            connection.execute(
                "UPDATE users SET email = ?, name = ?, avatar_url = ?, last_login_at = ?, is_admin = MAX(is_admin, ?) WHERE google_sub = ?",
                (email, name, avatar_url, now, is_admin, google_sub),
            )
            row = connection.execute("SELECT * FROM users WHERE google_sub = ?", (google_sub,)).fetchone()
        else:
            connection.execute(
                "INSERT INTO users (google_sub, email, name, avatar_url, is_admin, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (google_sub, email, name, avatar_url, is_admin, now, now),
            )
            row = connection.execute("SELECT * FROM users WHERE google_sub = ?", (google_sub,)).fetchone()
    return dict(row)


def get_user_by_id(user_id: int) -> dict | None:
    with db_lock, db_connect() as connection:
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return dict(row) if row else None

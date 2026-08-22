from __future__ import annotations

import json

from models.db import db_connect, db_lock
from models.opportunities import utc_now


def default_workspace(opportunity_id: str) -> dict:
    return {
        "opportunity_id": opportunity_id,
        "eligibility": [{"label": "Check year-group eligibility", "complete": False}, {"label": "Check right-to-work requirements", "complete": False}, {"label": "Check location and programme dates", "complete": False}],
        "required_documents": [{"label": "CV", "document_id": None, "complete": False}, {"label": "Cover letter", "document_id": None, "complete": False}, {"label": "Transcript", "document_id": None, "complete": False}],
        "cv_document_id": None,
        "cover_letter_document_id": None,
        "oa_plan": ["Complete numerical reasoning drill", "Complete situational judgement drill"],
        "interview_questions": ["Why this firm?", "Why this programme?", "Tell me about a time you solved a difficult problem."],
        "reminder_enabled": False,
        "reminder_date": None,
        "notes": "",
        "submission_evidence": None,
        "status": "Saved",
    }


def get_workspace(user_id: int, opportunity_id: str) -> dict:
    with db_lock, db_connect() as connection:
        row = connection.execute("SELECT payload FROM application_workspaces WHERE user_id = ? AND opportunity_id = ?", (user_id, opportunity_id)).fetchone()
    return json.loads(row["payload"]) if row else default_workspace(opportunity_id)


def save_workspace(user_id: int, opportunity_id: str, payload: dict) -> dict:
    payload["opportunity_id"] = opportunity_id
    updated_at = utc_now()
    with db_lock, db_connect() as connection:
        connection.execute(
            "INSERT INTO application_workspaces (user_id, opportunity_id, payload, updated_at) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(user_id, opportunity_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at",
            (user_id, opportunity_id, json.dumps(payload), updated_at),
        )
    payload["updated_at"] = updated_at
    return payload

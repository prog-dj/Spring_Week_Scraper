from __future__ import annotations

import json
import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage
import os

from models.db import db_connect, db_lock


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def send_status_alert(item: dict, previous_status: str | None) -> None:
    smtp_host = os.getenv("SMTP_HOST")
    recipient = os.getenv("ALERT_TO")
    if not smtp_host or not recipient:
        return
    message = EmailMessage()
    message["Subject"] = f"Springr status change: {item['company']} is {item['status']}"
    message["From"] = os.getenv("ALERT_FROM", os.getenv("SMTP_USER", "springr@localhost"))
    message["To"] = recipient
    message.set_content(f"{item['company']} - {item['programme']} changed from {previous_status or 'new'} to {item['status']}.\n\nEvidence: {item['evidence']}\nSource: {item['source_url']}\nChecked: {item['checked_at']}")
    try:
        with smtplib.SMTP(smtp_host, int(os.getenv("SMTP_PORT", "587")), timeout=15) as smtp:
            smtp.starttls()
            if os.getenv("SMTP_USER") and os.getenv("SMTP_PASSWORD"):
                smtp.login(os.environ["SMTP_USER"], os.environ["SMTP_PASSWORD"])
            smtp.send_message(message)
    except OSError:
        pass


def upsert_opportunity(item: dict) -> None:
    with db_lock, db_connect() as connection:
        old = connection.execute("SELECT status FROM opportunities WHERE id = ?", (item["id"],)).fetchone()
        connection.execute("""INSERT INTO opportunities (id, company, programme, sector, location, opportunity_url, source_url, discovered_via, deadline, programme_dates, status, confidence, evidence, application_process, eligibility, format, http_status, checked_at, last_error, logo, logo_class, opportunity_type, source_type, evidence_excerpt, prep_tags)
            VALUES (:id, :company, :programme, :sector, :location, :opportunity_url, :source_url, :discovered_via, :deadline, :programme_dates, :status, :confidence, :evidence, :application_process, :eligibility, :format, :http_status, :checked_at, :last_error, :logo, :logo_class, :opportunity_type, :source_type, :evidence_excerpt, :prep_tags)
            ON CONFLICT(id) DO UPDATE SET company=excluded.company, programme=excluded.programme, sector=excluded.sector, location=excluded.location, deadline=excluded.deadline, programme_dates=excluded.programme_dates, status=excluded.status, confidence=excluded.confidence, evidence=excluded.evidence, application_process=excluded.application_process, eligibility=excluded.eligibility, format=excluded.format, http_status=excluded.http_status, checked_at=excluded.checked_at, last_error=excluded.last_error, logo=excluded.logo, logo_class=excluded.logo_class, opportunity_type=excluded.opportunity_type, source_type=excluded.source_type, evidence_excerpt=excluded.evidence_excerpt, prep_tags=excluded.prep_tags""", item)
        if old is None or old["status"] != item["status"]:
            connection.execute("INSERT INTO status_history (opportunity_id, status, evidence, observed_at) VALUES (?, ?, ?, ?)", (item["id"], item["status"], item["evidence"], item["checked_at"]))
            send_status_alert(item, old["status"] if old else None)


# Career-page URLs are frequently discovered years after a programme has closed
# (via search-engine caches, or job boards that never took the listing down), and
# some regional variants show a deadline that's simply wrong. Rather than delete an
# expired opportunity the moment its deadline passes -- which would yank a
# just-closed listing away from someone auditing what they missed -- it's given a
# grace window before it's hard-deleted, and it stops appearing in the discovery
# feed immediately once expired, well before that deletion happens.
EXPIRED_GRACE_DAYS = 30


def _untracked_ids(connection, candidate_ids: list[str]) -> list[str]:
    """Deleting an opportunity a user has actually saved/applied to/built a
    workspace for would either violate the FK constraint (status_history,
    applications, saved_opportunities, application_workspaces all reference
    opportunities.id) or, if cascaded, silently destroy that user's tracking
    history. So candidates for deletion are filtered down to ones nobody has
    touched; anything tracked is simply left in place (and, for expired ones,
    excluded from the discovery feed by stored_opportunities' own filter --
    see EXPIRED_GRACE_DAYS -- so it doesn't clutter fresh search results either
    way)."""
    if not candidate_ids:
        return []
    placeholders = ",".join("?" for _ in candidate_ids)
    tracked = set()
    for table in ("applications", "saved_opportunities", "application_workspaces"):
        rows = connection.execute(f"SELECT DISTINCT opportunity_id FROM {table} WHERE opportunity_id IN ({placeholders})", candidate_ids).fetchall()
        tracked.update(row["opportunity_id"] for row in rows)
    return [opportunity_id for opportunity_id in candidate_ids if opportunity_id not in tracked]


def _delete_opportunities(connection, ids: list[str]) -> int:
    if not ids:
        return 0
    placeholders = ",".join("?" for _ in ids)
    # status_history has no ON DELETE CASCADE, so it's cleared manually first.
    connection.execute(f"DELETE FROM status_history WHERE opportunity_id IN ({placeholders})", ids)
    connection.execute(f"DELETE FROM opportunities WHERE id IN ({placeholders})", ids)
    return len(ids)


def cleanup_stale_opportunities(current_ids: list[str]) -> int:
    """Removes opportunities that discovery no longer found this run (dead links,
    excluded sources, etc.) -- but only ones nobody has tracked; see _untracked_ids."""
    with db_lock, db_connect() as connection:
        if current_ids:
            placeholders = ",".join("?" for _ in current_ids)
            stale_ids = [row["id"] for row in connection.execute(f"SELECT id FROM opportunities WHERE id NOT IN ({placeholders})", current_ids).fetchall()]
        else:
            stale_ids = [row["id"] for row in connection.execute("SELECT id FROM opportunities").fetchall()]
        return _delete_opportunities(connection, _untracked_ids(connection, stale_ids))


def purge_expired_opportunities() -> int:
    """Hard-deletes opportunities whose deadline passed more than EXPIRED_GRACE_DAYS
    ago and that nobody has tracked. Returns the number actually deleted."""
    with db_lock, db_connect() as connection:
        expired_ids = [row["id"] for row in connection.execute(
            "SELECT id FROM opportunities WHERE deadline IS NOT NULL AND deadline < date('now', ?)",
            (f"-{EXPIRED_GRACE_DAYS} days",),
        ).fetchall()]
        return _delete_opportunities(connection, _untracked_ids(connection, expired_ids))


def record_discovery_run(started_at: str, finished_at: str, query_count: int, result_count: int, verified_count: int) -> None:
    with db_lock, db_connect() as connection:
        connection.execute("INSERT INTO discovery_runs (started_at, finished_at, query_count, result_count, verified_count) VALUES (?, ?, ?, ?, ?)", (started_at, finished_at, query_count, result_count, verified_count))


def record_discovery_error(started_at: str, finished_at: str, query_count: int, error: str) -> None:
    with db_lock, db_connect() as connection:
        connection.execute("INSERT INTO discovery_runs (started_at, finished_at, query_count, error) VALUES (?, ?, ?, ?)", (started_at, finished_at, query_count, error))


def record_seed_failures(failures: list[dict]) -> None:
    with db_lock, db_connect() as connection:
        connection.execute("DELETE FROM seed_failures")
        checked_at = utc_now()
        connection.executemany("INSERT INTO seed_failures (company, careers_url, error, checked_at) VALUES (?, ?, ?, ?)", [(f["company"], f["careers_url"], f["error"], checked_at) for f in failures])


def opportunity_exists(opportunity_id: str) -> bool:
    with db_lock, db_connect() as connection:
        row = connection.execute("SELECT 1 FROM opportunities WHERE id = ?", (opportunity_id,)).fetchone()
    return row is not None


def stored_opportunities() -> list[dict]:
    with db_lock, db_connect() as connection:
        rows = connection.execute(
            "SELECT * FROM opportunities WHERE deadline IS NULL OR deadline >= date('now', ?) "
            "ORDER BY CASE status WHEN 'open' THEN 1 WHEN 'upcoming' THEN 2 WHEN 'unknown' THEN 3 ELSE 4 END, deadline IS NULL, deadline",
            (f"-{EXPIRED_GRACE_DAYS} days",),
        ).fetchall()
    opportunities = []
    for row in rows:
        item = dict(row)

        def _parse_list(raw: str | None) -> list | None:
            if not raw:
                return None
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                return None

        item.update({
            "firm": item["company"], "role": item["programme"], "url": item["source_url"],
            "source": item["evidence"] or item["source_url"],
            "logoClass": item["logo_class"], "type": item["opportunity_type"],
            "application_process": _parse_list(item["application_process"]),
            "eligibility": _parse_list(item["eligibility"]),
        })
        opportunities.append(item)
    return opportunities


def status_history(opportunity_id: str | None) -> list[dict]:
    with db_lock, db_connect() as connection:
        if opportunity_id:
            rows = connection.execute("SELECT * FROM status_history WHERE opportunity_id = ? ORDER BY observed_at DESC LIMIT 50", (opportunity_id,)).fetchall()
        else:
            rows = connection.execute("SELECT * FROM status_history ORDER BY observed_at DESC LIMIT 200").fetchall()
    return [dict(row) for row in rows]


def seed_failure_rows() -> list[dict]:
    with db_lock, db_connect() as connection:
        rows = connection.execute("SELECT company, careers_url, error, checked_at FROM seed_failures ORDER BY company").fetchall()
    return [dict(row) for row in rows]

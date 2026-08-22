"""Database connection and schema management. SQLite, single file -- see the
pre-production plan's reasoning for staying on SQLite rather than Postgres at this
stage. Migrations are idempotent, run-on-boot PRAGMA/ALTER checks, matching the
project's existing style rather than introducing a separate migration tool."""
from __future__ import annotations

import os
import sqlite3
import threading
from pathlib import Path

from scraping.constants import ROOT

DB_PATH = Path(os.getenv("SPRINGR_DB", ROOT / "springr.db"))
db_lock = threading.Lock()


def db_connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def _table_columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}


def init_db() -> None:
    with db_lock, db_connect() as connection:
        existing_tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}

        # application_workspaces predates the multi-user schema and was keyed only on
        # opportunity_id. There is no real user data to preserve yet (pre-production,
        # no accounts exist before this migration), so rather than a backfill dance,
        # the old single-tenant table is dropped and recreated user-scoped.
        if "application_workspaces" in existing_tables and "user_id" not in _table_columns(connection, "application_workspaces"):
            connection.execute("DROP TABLE application_workspaces")

        connection.executescript("""
        CREATE TABLE IF NOT EXISTS opportunities (
            id TEXT PRIMARY KEY, company TEXT NOT NULL, programme TEXT NOT NULL,
            sector TEXT, location TEXT, opportunity_url TEXT NOT NULL UNIQUE,
            source_url TEXT NOT NULL, discovered_via TEXT NOT NULL, deadline TEXT,
            programme_dates TEXT, status TEXT NOT NULL, confidence TEXT NOT NULL,
            evidence TEXT, http_status INTEGER,
            checked_at TEXT NOT NULL, last_error TEXT, logo TEXT, logo_class TEXT,
            opportunity_type TEXT
        );
        CREATE TABLE IF NOT EXISTS status_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT, opportunity_id TEXT NOT NULL,
            status TEXT NOT NULL, evidence TEXT, observed_at TEXT NOT NULL,
            FOREIGN KEY(opportunity_id) REFERENCES opportunities(id)
        );
        CREATE TABLE IF NOT EXISTS discovery_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL,
            finished_at TEXT, query_count INTEGER NOT NULL,
            result_count INTEGER NOT NULL DEFAULT 0, verified_count INTEGER NOT NULL DEFAULT 0,
            error TEXT
        );
        CREATE TABLE IF NOT EXISTS seed_failures (
            id INTEGER PRIMARY KEY AUTOINCREMENT, company TEXT NOT NULL,
            careers_url TEXT NOT NULL, error TEXT NOT NULL, checked_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            google_sub TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL,
            name TEXT,
            avatar_url TEXT,
            is_admin INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            last_login_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS application_workspaces (
            user_id INTEGER NOT NULL REFERENCES users(id),
            opportunity_id TEXT NOT NULL,
            payload TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (user_id, opportunity_id),
            FOREIGN KEY(opportunity_id) REFERENCES opportunities(id)
        );
        CREATE TABLE IF NOT EXISTS applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
            status TEXT NOT NULL DEFAULT 'Saved',
            next_action TEXT,
            progress INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(user_id, opportunity_id)
        );
        CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            name TEXT NOT NULL,
            doc_type TEXT NOT NULL,
            size_bytes INTEGER,
            status TEXT,
            storage_ref TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS saved_opportunities (
            user_id INTEGER NOT NULL REFERENCES users(id),
            opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
            created_at TEXT NOT NULL,
            PRIMARY KEY (user_id, opportunity_id)
        );
        """)

        columns = _table_columns(connection, "opportunities")
        if "source_type" not in columns:
            connection.execute("ALTER TABLE opportunities ADD COLUMN source_type TEXT NOT NULL DEFAULT 'unknown'")
        if "evidence_excerpt" not in columns:
            connection.execute("ALTER TABLE opportunities ADD COLUMN evidence_excerpt TEXT")
        if "prep_tags" not in columns:
            connection.execute("ALTER TABLE opportunities ADD COLUMN prep_tags TEXT")
        if "application_process" not in columns:
            connection.execute("ALTER TABLE opportunities ADD COLUMN application_process TEXT")
        if "eligibility" not in columns:
            connection.execute("ALTER TABLE opportunities ADD COLUMN eligibility TEXT")
        if "format" not in columns:
            connection.execute("ALTER TABLE opportunities ADD COLUMN format TEXT")
        if "process_confirmed" in columns:
            connection.execute("ALTER TABLE opportunities DROP COLUMN process_confirmed")
        if "acceptance_rate" in columns:
            connection.execute("ALTER TABLE opportunities DROP COLUMN acceptance_rate")
        if "perks" in columns:
            connection.execute("ALTER TABLE opportunities DROP COLUMN perks")

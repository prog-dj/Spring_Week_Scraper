-- D1 schema for Springr. Ported from models/db.py's SQLite schema, collapsed to
-- final column state (D1 migrations are applied once via wrangler d1 execute,
-- no need for the idempotent ALTER-dance the old sqlite3 boot code used).

CREATE TABLE IF NOT EXISTS opportunities (
    id TEXT PRIMARY KEY, company TEXT NOT NULL, programme TEXT NOT NULL,
    sector TEXT, location TEXT, opportunity_url TEXT NOT NULL UNIQUE,
    source_url TEXT NOT NULL, discovered_via TEXT NOT NULL, deadline TEXT,
    programme_dates TEXT, status TEXT NOT NULL, confidence TEXT NOT NULL,
    evidence TEXT, http_status INTEGER,
    checked_at TEXT NOT NULL, last_error TEXT, logo TEXT, logo_class TEXT,
    opportunity_type TEXT,
    source_type TEXT NOT NULL DEFAULT 'unknown',
    evidence_excerpt TEXT,
    prep_tags TEXT,
    application_process TEXT,
    eligibility TEXT,
    format TEXT
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

-- storage_ref now points at an R2 object key (documents/<user_id>/<uuid>-<filename>)
-- rather than staying NULL -- real server-side file storage, not client-side IndexedDB.
CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    doc_type TEXT NOT NULL,
    size_bytes INTEGER,
    status TEXT,
    storage_ref TEXT,
    content_type TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS saved_opportunities (
    user_id INTEGER NOT NULL REFERENCES users(id),
    opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, opportunity_id)
);

-- Rate limiting for login/upload endpoints (fixed-window counter per IP+route).
CREATE TABLE IF NOT EXISTS rate_limits (
    bucket_key TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    window_started_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_status_history_opportunity ON status_history(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_opportunities_user ON saved_opportunities(user_id);

# Springr

Springr is a source-aware spring-week application workspace. It discovers UK
spring-week/insight-programme opportunities from employer career pages, verifies
deadlines/eligibility/format with evidence-based extraction, and lets signed-in
students track applications and documents against them.

## Run locally

```powershell
pip install -r requirements.txt
python -m playwright install chromium
python app.py
```

Open <http://127.0.0.1:4173>. You'll land on a sign-in screen — see **Configuration**
below for what you need before Google login actually works.

## Configuration

Copy `.env.example` to `.env` and fill in:

- `SERPER_API_KEY` — for search-based discovery (optional; direct employer-page
  crawling from `sources.json` works without it).
- `FLASK_SECRET_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ADMIN_EMAILS` —
  required for login. See [DEPLOY.md](DEPLOY.md) for exactly how to obtain these.

`SPRINGR_REFRESH_HOURS` controls the background discovery refresh interval.

## Architecture

- `app.py` / `config.py` — Flask application factory and configuration.
- `auth/` — Google OAuth 2.0 login (Authlib: PKCE, CSRF state, ID-token
  verification) and the `@login_required`/`@admin_required` decorators.
- `scraping/` — the discovery/extraction engine (Serper search, seed-employer
  crawling, Playwright rendering, deadline/eligibility/format extraction,
  multi-programme page splitting). No Flask or DB dependency — pure scraping logic.
- `models/` — all database access, behind a small function-per-operation API so
  routes and scraping code never touch SQL directly.
- `api/` — Flask blueprints. `routes.py` is public/read-only;
  `workspace_routes.py`/`applications_routes.py`/`documents_routes.py`/
  `saved_routes.py` are per-user and require login; `admin_routes.py` (the
  discovery-trigger endpoints) requires admin.
- `static/` — the frontend (vanilla HTML/JS/CSS, no build step).

The `/api/discover` and `/api/opportunities/refresh` endpoints are admin-only —
each run costs real Serper API spend and spins up Playwright against many employer
sites, so they must never be publicly triggerable. The background scheduler thread
calls the same discovery function directly in-process on a timer and doesn't go
through those HTTP endpoints at all.

## Discovery

Two independent discovery paths feed the same verification and dedupe pipeline:

- **Search discovery** (`scraping.discovery.search_serper`) runs generic
  spring-week/insight-week queries against Serper.dev. Good at finding new/unknown
  employers, but bounded by search ranking and requires `SERPER_API_KEY`.
- **Direct crawl** (`scraping.discovery.search_seed_employers`) reads
  `sources.json`, a curated list of ~90 known UK spring-week employers across
  banking, asset management, trading, consulting, law, tech, and corporates. For
  each one it fetches the employer's careers hub page and `/sitemap.xml` directly
  and pulls out links that look like an insight/spring-week opportunity — no search
  engine involved, so it doesn't depend on ranking and works even without a Serper
  key. This is the primary lever for maximizing coverage: add more employers to
  `sources.json` to expand it.

Both fetch phases run candidate/employer requests concurrently and share a handful
of Playwright browser instances for any page that needs JS rendering, rather than
launching a new browser per page.

Results from both paths are merged, verified (`requests` + BeautifulSoup, falling
back to Playwright/Chromium for blocked or JS-heavy pages), and deduped by
normalized company + opportunity type so the same opportunity discovered via
multiple URLs only appears once. Hub pages that describe more than one distinct
programme (e.g. a law firm's separate "First Year Insight Day" and "Vacation
Scheme") are detected and split into separate opportunity rows so their deadlines
and eligibility don't get mixed together.

Employer URLs in `sources.json` can go stale. When a seed employer's page can't be
fetched at all, it's recorded in the `seed_failures` table and exposed via
`GET /api/seed-health` rather than silently dropped.

Social media, forums, and pure aggregator sites (Instagram, LinkedIn, Facebook,
Reddit, Gradcracker, thestudentroom, etc.) are excluded from search discovery
entirely — they don't host the actual application page and were a source of
duplicate/noisy entries.

## Data provenance

Every discovered opportunity is stored in SQLite with its source URL, discovery
provider, HTTP status, evidence text, confidence, checked timestamp, and extraction
error. Status transitions are stored in `status_history`; refresh attempts are
stored in `discovery_runs`.

The verifier only extracts a deadline, eligibility, application process, or format
when it finds explicit supporting text on the source page — it does not guess or
infer these from unrelated context, and simply omits a field rather than showing a
fabricated placeholder when it isn't stated.

## Accounts and data model

Login is Google OAuth only (see [DEPLOY.md](DEPLOY.md) to set up your own OAuth
client — it's free). The scraped `opportunities` catalog is global/shared; saved
opportunities, tracked applications, document metadata, and per-opportunity
workspaces are all scoped to the signed-in user. Uploaded document *files* stay in
the browser's IndexedDB per-device — only their metadata (name, type, size) syncs to
the account.

## Deploying

See [DEPLOY.md](DEPLOY.md) for the full walkthrough (Google OAuth client setup,
environment variables, Docker build, hosting recommendations).

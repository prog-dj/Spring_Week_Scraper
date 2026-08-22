# Springr

Springr is a source-aware spring-week application workspace. It discovers UK
spring-week/insight-programme opportunities from employer career pages, verifies
deadlines/eligibility/format with evidence-based extraction, and lets signed-in
students track applications and documents against them.

## Run locally

The app is a Cloudflare Worker now (Hono + D1 + R2), not a Flask server. See
[DEPLOY.md](DEPLOY.md) for full setup; the short version:

```powershell
cd worker
npm install
npm run dev
```

Open <http://127.0.0.1:8787>. You'll land on a sign-in screen — see
[DEPLOY.md](DEPLOY.md) for what you need before Google login actually works
(a Google OAuth client, D1/R2 resources, and Worker secrets).

To test the scraper against a local dev server:

```powershell
pip install -r requirements.txt
python -m playwright install chromium
python -m scraping.push_adapter
```

## Configuration

Almost all configuration is Cloudflare Worker secrets (`wrangler secret put`),
not a `.env` file — see [DEPLOY.md](DEPLOY.md) for the full list and how to
obtain each one (Google OAuth client, session secret, admin emails, ingest
secret, optional Sentry DSN). `.env.example` covers only the handful of
variables needed to run the Python scraper locally.

## Architecture

- `worker/` — the Cloudflare Worker (Hono, TypeScript). Serves the API, the
  static frontend, and owns all persistence (D1) and file storage (R2).
  - `src/auth/` — Google OAuth 2.0 login (manually implemented PKCE + CSRF
    state + ID-token verification via `jose`, since Authlib doesn't exist for
    Workers) and the session-cookie / `requireAuth`/`requireAdmin` middleware.
  - `src/db/` — one module per table, the only code that touches D1 SQL.
  - `src/routes/` — Hono route handlers: `api.ts` is public/read-only;
    `workspace.ts`/`applications.ts`/`documents.ts`/`saved.ts` are per-user
    (require login); `admin.ts` (manually triggering a scrape) requires admin;
    `ingest.ts` is the protected endpoint GitHub Actions pushes scrape results to.
  - `src/storage/` — file-upload validation (magic-byte sniffing, size caps)
    and the D1-backed rate limiter.
- `scraping/` — the discovery/extraction engine (Serper search, seed-employer
  crawling, Playwright rendering, deadline/eligibility/format extraction,
  multi-programme page splitting). No web-framework or DB dependency — pure
  scraping logic, run by GitHub Actions rather than an always-on server.
  `push_adapter.py` is the GitHub Actions entry point: runs the same
  discovery/verification functions, then POSTs the results to the Worker's
  `/internal/ingest` endpoint instead of writing to a local database.
- `static/` — the frontend (vanilla HTML/JS/CSS, no build step), served
  directly by the Worker via Workers Static Assets.
- `.github/workflows/scrape.yml` — runs the scraper on a schedule (every 6
  hours) using a real Ubuntu runner + Chromium, since Cloudflare Workers can't
  run Playwright or long-lived processes.

The manual-trigger admin endpoints (`GET /api/discover`,
`GET /api/opportunities/refresh`) don't run the scraper themselves anymore —
they just dispatch the GitHub Actions workflow early, admin-only, since each
run still costs real Serper API spend.

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

Every discovered opportunity is stored in D1 with its source URL, discovery
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
workspaces are all scoped to the signed-in user. Uploaded document files are
stored server-side in Cloudflare R2 (validated by magic-byte sniffing, size-capped
at 2MB, PDF/DOC/DOCX only) — real multi-device access, not per-browser storage.

## Deploying

See [DEPLOY.md](DEPLOY.md) for the full walkthrough (Cloudflare account setup,
D1/R2 provisioning, Google OAuth client, Worker secrets, GitHub Actions secrets).

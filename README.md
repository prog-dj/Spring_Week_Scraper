# Springboard

Springboard is a source-aware spring-week application workspace. It includes opportunity discovery, an application pipeline, local document records, OA practice, interview prompts, and cover-letter feedback.

## Run

From this directory:

```powershell
python server.py
```

Open <http://127.0.0.1:4173>.

The server uses only Python's standard library. It serves the frontend and exposes:

- `GET /api/health` for a health check
- `GET /api/opportunities` for cached source results
- `GET /api/opportunities/refresh` to force a fresh source check

## Configuration

Copy `.env.example` values into your environment and set `SERPER_API_KEY`. `SPRINGBOARD_REFRESH_HOURS` controls the background refresh interval.

## Discovery

Two independent discovery paths feed the same verification and dedupe pipeline:

- **Search discovery** (`search_serper`) runs generic spring-week/insight-week queries against Serper.dev. Good at finding new/unknown employers, but bounded by search ranking and requires `SERPER_API_KEY`.
- **Direct crawl** (`search_seed_employers`) reads `sources.json`, a curated list of ~90 known UK spring-week employers across banking, asset management, trading, consulting, law, tech, and corporates. For each one it fetches the employer's careers hub page and `/sitemap.xml` directly and pulls out links that look like an insight/spring-week opportunity — no search engine involved, so it doesn't depend on ranking and works even without a Serper key. This is the primary lever for maximizing coverage: add more employers to `sources.json` to expand it.

Both fetch phases run candidate/employer requests concurrently (`ThreadPoolExecutor`) and share a single Playwright browser instance for any page that needs JS rendering, rather than launching a new browser per page — this keeps a ~90-employer crawl to roughly a minute instead of several.

Results from both paths are merged, verified (`requests` + BeautifulSoup, falling back to Playwright/Chromium for blocked or JS-heavy pages — install once with `python -m playwright install chromium`), and deduped by normalized company + opportunity type so the same opportunity discovered via multiple URLs (e.g. an employer page and a syndicated copy) only appears once.

Employer URLs in `sources.json` can go stale (companies restructure career pages). When a seed employer's page can't be fetched at all, it's recorded in the `seed_failures` table and exposed via `GET /api/seed-health` rather than silently dropped, so the list can be maintained over time.

Social media, forums, and pure aggregator sites (Instagram, LinkedIn, Facebook, Reddit, Gradcracker, thestudentroom, etc.) are excluded from search discovery entirely — they don't host the actual application page and were a source of duplicate/noisy entries.

## Data provenance

Every discovered opportunity is stored in SQLite (`springboard.db`) with its source URL, discovery provider, HTTP status, evidence text, confidence, checked timestamp, and extraction error. Status transitions are stored in `status_history`; refresh attempts are stored in `discovery_runs`.

The verifier only extracts a deadline or acceptance percentage when it finds explicit supporting text. It does not estimate acceptance rates from unrelated admissions or hiring data. When a source blocks requests, moves, times out, or does not state a field, the UI shows that field as unavailable.

The dashboard opportunity modal includes the evidence excerpt, confidence, source type, programme dates, suggested preparation tags, official source link, and recorded status history. Optional email alerts are sent when a stored opportunity changes status if `SMTP_HOST` and `ALERT_TO` are configured.

Career sites change their URLs and may block automated requests. For production use, review each source against its terms and robots policy, add rate limiting and monitoring, and move SQLite to PostgreSQL when deploying multiple workers.

Application selections and document records are currently stored in browser `localStorage` so the workflow is easy to test locally.

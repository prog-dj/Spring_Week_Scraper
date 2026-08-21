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

Copy `.env.example` values into your environment and set `SERPER_API_KEY`. The discovery worker then searches generic spring-week and insight-week queries rather than a fixed firm list. `SPRINGBOARD_REFRESH_HOURS` controls the background refresh interval.

The pipeline uses Serper.dev for discovery, `requests` and BeautifulSoup for ordinary pages, and Playwright/Chromium when a page is blocked or primarily JavaScript-rendered. Install the browser runtime once with `python -m playwright install chromium`.

## Data provenance

Every discovered opportunity is stored in SQLite (`springboard.db`) with its source URL, discovery provider, HTTP status, evidence text, confidence, checked timestamp, and extraction error. Status transitions are stored in `status_history`; refresh attempts are stored in `discovery_runs`.

The verifier only extracts a deadline or acceptance percentage when it finds explicit supporting text. It does not estimate acceptance rates from unrelated admissions or hiring data. When a source blocks requests, moves, times out, or does not state a field, the UI shows that field as unavailable.

Career sites change their URLs and may block automated requests. For production use, review each source against its terms and robots policy, add rate limiting and monitoring, and move SQLite to PostgreSQL when deploying multiple workers.

Application selections and document records are currently stored in browser `localStorage` so the workflow is easy to test locally.

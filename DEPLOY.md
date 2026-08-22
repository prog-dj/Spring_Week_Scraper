# Deploying Springr

This covers the steps only you can do — creating accounts and credentials — plus how
to actually ship the app once you have them. Everything else (the code, the
Dockerfile, the multi-user schema, the admin lock-down) is already done.

## 1. Create a Google OAuth client (free, ~10 minutes)

1. Go to [console.cloud.google.com](https://console.cloud.google.com), create a
   project (or use an existing one).
2. **APIs & Services → OAuth consent screen** — choose "External", fill in the app
   name and your email, add your email as a test user if the app stays in "Testing"
   mode (fine for a small user base; "Publishing" removes the 100-test-user cap but
   requires a Google verification review if you request sensitive scopes — this app
   only requests `openid email profile`, which doesn't require that review).
3. **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**,
   application type **Web application**.
4. Add **Authorized redirect URIs**:
   - `http://127.0.0.1:4173/auth/callback` (local dev)
   - `https://<your-production-domain>/auth/callback` (once you know it — see
     step 3 below; you can add this after your first deploy and re-save)
5. Copy the **Client ID** and **Client secret** — you'll paste these into
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

## 2. Generate a Flask secret key

```
python -c "import secrets; print(secrets.token_hex(32))"
```

This signs the session cookie. Treat it like a password — never commit it, and use a
different one for local dev vs. production.

## 3. Set your environment variables

Copy `.env.example` to `.env` locally, or set these directly in your hosting
platform's secrets manager for production:

| Variable | Value |
|---|---|
| `FLASK_SECRET_KEY` | from step 2 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | from step 1 |
| `ADMIN_EMAILS` | your Google account email(s), comma-separated — grants `/api/discover` access |
| `SERPER_API_KEY` | your existing Serper.dev key |
| `SPRINGR_DB` | `/data/springr.db` in production (see step 4's volume mount) |
| `FLASK_ENV` | leave unset in production (only set to `development` locally) |

## 4. Deploy

The app is a Docker image (Playwright/Chromium makes it a few hundred MB to ~1.5GB —
this is an inherent cost of the scraping feature, not something the login work
added). It needs a **persistent volume** for the SQLite file, since without one all
data is wiped on every redeploy.

I built and tested the app locally, but could not build/run the actual Docker image
in this session (Docker Desktop wasn't running here) — **build and run it locally
once yourself before deploying**, to catch anything environment-specific:

```
docker build -t springr .
docker run -p 8080:8080 --env-file .env -v springr_data:/data springr
```

Then visit `http://localhost:8080` and confirm login works end-to-end.

### Recommended hosts

Both support Docker deploys with persistent disks (a hard requirement here) —
buildpack-style platforms (classic Heroku, Vercel/Netlify) are a poor fit since they
don't handle "install a real browser binary" workloads well and often lack
persistent disks at all.

- **[Fly.io](https://fly.io)** — `fly launch` picks up the Dockerfile automatically;
  `fly volumes create springr_data --size 1` then mount it at `/data` in
  `fly.toml`.
- **[Render.com](https://render.com)** — create a "Web Service" from your repo,
  it detects the Dockerfile; add a persistent disk mounted at `/data` in the
  service settings. **Caveat**: Render's free tier spins down on idle, which would
  interrupt the background scheduler (periodic re-scrape) — if you want the
  scheduler to run reliably, either use a paid always-on service, or run the
  scheduler as a separate "Background Worker" / "Cron Job" service instead of
  relying on the web service staying up (set `RUN_SCHEDULER=0` on the web service
  and `RUN_SCHEDULER=1` on that separate worker).

After your first deploy, go back to Google Cloud Console and add your real
`https://<your-domain>/auth/callback` to the OAuth client's authorized redirect URIs
if you didn't already know the domain in step 1.

## 5. Verify after deploying

- Visit the site — you should see Overview and Find Opportunities right away, no
  sign-in required. Applications and Documents should show a "Sign in to..." locked
  panel instead of your data.
- Sign in with Google — confirm you land back on the dashboard with your real
  name/avatar, and Applications/Documents unlock.
- As your admin account, confirm the "Refresh data" button is visible and works.
- Sign in with a second Google account (or ask a friend to) — confirm they get their
  own empty Applications/Documents/Saved, not yours, and that the "Refresh data"
  button is hidden for them (non-admin).
- Check the scheduler is actually running on whichever service has
  `RUN_SCHEDULER=1` — new opportunities should appear after the first refresh
  interval (`SPRINGR_REFRESH_HOURS`, default 6h) without anyone visiting the
  site.

## What's deliberately deferred (not built this round)

- **Document file storage**: uploaded file *bytes* stay in the browser's IndexedDB,
  per-device — only metadata (name, type, size) syncs to your account. True
  multi-device document access would need real server-side file storage (e.g. an
  S3-compatible bucket), which is separate scope from the login work.
- **Editable profile fields** beyond what Google provides (university, target
  sector, etc.) — the profile currently just shows your real Google name/email.
- **Postgres**: staying on SQLite for now — see the reasoning in the project's saved
  plan file if you want the full write-up. Revisit if you get real concurrent
  multi-user write load or need to scale beyond one instance.
- **Apple Sign In**: not built — requires a paid $99/year Apple Developer account,
  which you declined for now. Nothing in the code blocks adding it later.

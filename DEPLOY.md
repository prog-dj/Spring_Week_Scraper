# Deploying Springr (Cloudflare Workers + D1 + R2 + GitHub Actions)

The whole stack runs on free tiers: Cloudflare Workers (API + frontend hosting),
D1 (database), R2 (file storage), and GitHub Actions (the scheduled scraper,
since Workers can't run Playwright). Everything below is a one-time setup —
you only have to do it once.

## 1. Cloudflare account + Wrangler login

```bash
cd worker
npm install
npx wrangler login
```

This opens a browser to authorize Wrangler against your Cloudflare account.

## 2. Create the D1 database

```bash
npx wrangler d1 create springr
```

Copy the `database_id` it prints into `worker/wrangler.toml`, replacing
`replace-after-running-wrangler-d1-create`. Then apply the schema:

```bash
npm run db:migrate:remote
```

## 3. Create the R2 bucket

```bash
npx wrangler r2 bucket create springr-documents
```

The binding name (`DOCUMENTS`) and bucket name are already set in
`wrangler.toml` — nothing else to configure here.

## 4. Google OAuth client

In [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services
→ Credentials → **Create OAuth 2.0 Client ID** (Web application):

- Authorized redirect URIs:
  - `https://<your-worker-subdomain>.workers.dev/auth/callback` (or your custom domain)
  - `http://127.0.0.1:8787/auth/callback` (for local `wrangler dev`)

You'll get a Client ID and Client Secret — used in step 6.

## 5. Generate secrets

```bash
python -c "import secrets; print(secrets.token_hex(32))"   # run twice: SESSION_SECRET and INGEST_SHARED_SECRET
```

## 6. Set Worker secrets

From `worker/`:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler secret put ADMIN_EMAILS          # comma-separated, e.g. you@example.com
npx wrangler secret put INGEST_SHARED_SECRET  # same value GitHub Actions will use in step 8
```

Optional:

```bash
npx wrangler secret put SENTRY_DSN            # error tracking, see step 9
npx wrangler secret put GITHUB_TOKEN          # only if you want the admin "trigger scrape now" button to work
npx wrangler secret put GITHUB_REPO           # e.g. yourname/springr
```

Also run `npx wrangler secret put ENVIRONMENT` and enter `production` — this
overrides the `"development"` default in `wrangler.toml` so session cookies
get marked `Secure` (HTTPS-only) once deployed.

## 7. Deploy the Worker

```bash
npm run deploy
```

This publishes to `https://<your-worker-name>.<your-subdomain>.workers.dev`
and serves both the API and the `static/` frontend from that one origin.

## 8. GitHub Actions (the scraper)

In your GitHub repo → Settings → Secrets and variables → Actions, add:

- `SPRINGR_WORKER_URL` — your deployed Worker URL (from step 7)
- `SPRINGR_INGEST_SECRET` — same value as `INGEST_SHARED_SECRET` in step 6
- `SERPER_API_KEY` — your [Serper.dev](https://serper.dev) API key

The workflow (`.github/workflows/scrape.yml`) runs automatically twice a day
(00:02 and 09:10 GMT) once these secrets exist — no further setup needed. You
can also trigger it manually from the repo's Actions tab (`Run workflow`).

## 9. Sentry (optional, recommended)

Create a free project at [sentry.io](https://sentry.io) (Cloudflare Workers
platform), copy its DSN, and set it as the `SENTRY_DSN` Worker secret (step 6).
Leave it unset to skip error tracking entirely — the app runs fine without it.

## 10. Custom domain + WAF (optional, recommended)

If you own a domain, add it to Cloudflare (free plan) and add a Worker route
for it in the dashboard (Workers & Pages → your worker → Settings →
Triggers → Custom Domains). This puts Cloudflare's proxy/WAF/DDoS protection
in front of the app at no extra cost, and gives you a real domain instead of
`*.workers.dev`.

## Local development

```bash
cd worker
npm run dev            # wrangler dev, serves the Worker + static frontend at http://127.0.0.1:8787
```

`wrangler dev` uses a local D1/R2 emulation by default (`--local`, the
implicit default) — nothing you do locally touches production data. To test
the scraper against your local dev server:

```bash
SPRINGR_WORKER_URL=http://127.0.0.1:8787 SPRINGR_INGEST_SECRET=<same as wrangler.toml local var> python -m scraping.push_adapter
```

## Everything above is genuinely free

- **Workers**: 100,000 requests/day free
- **D1**: 5GB storage, 5M row reads/day free
- **R2**: 10GB storage, zero egress fees, free
- **GitHub Actions**: 2,000 min/month free (private repo) — a scrape run takes
  a few minutes, so two runs a day use a small fraction of that
- **Sentry**: 5,000 errors/month free tier

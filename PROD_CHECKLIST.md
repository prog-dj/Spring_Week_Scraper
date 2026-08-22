# Production readiness checklist

Status of everything from the original prod-readiness ask, against the current
Cloudflare Workers + D1 + R2 + GitHub Actions architecture.

## Done

- **File storage security** — documents are stored server-side in R2, not the
  client. Uploads are validated by magic-byte sniffing (`worker/src/storage/fileValidation.ts`),
  not just extension/declared Content-Type (both are attacker-controlled).
  Allowed types: PDF, DOC, DOCX. 2MB size cap. Rejects a file whose
  real content doesn't match its extension (e.g. an `.exe` renamed to `.pdf`).
- **Private file access** — downloads (`GET /api/documents/:id/download`) check
  the document belongs to the requesting session's user before serving it, and
  set `Cache-Control: private, no-store` so a shared proxy/CDN never caches
  another user's file.
- **CSRF protection** — the OAuth login flow uses a signed, short-lived
  state+PKCE cookie (`worker/src/auth/session.ts`) checked against the
  callback's `state` param. All other mutating routes require the session
  cookie (`SameSite=Lax`, `HttpOnly`), which a cross-site form/script can't
  forge or read.
- **XSS / clickjacking headers** — every response gets `Content-Security-Policy`,
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, and `Permissions-Policy` (`worker/src/index.ts`).
- **Rate limiting** — login attempts (10/min per IP) and document uploads
  (20/hour per user), backed by a D1 fixed-window counter
  (`worker/src/storage/rateLimit.ts`).
- **Sentry logging** — wired via `@sentry/cloudflare` (`withSentry` wrapping
  the whole app in `worker/src/index.ts`); active once `SENTRY_DSN` is set as
  a Worker secret, no-ops otherwise.
- **Auth** — Google OAuth 2.0 with PKCE, ID-token signature verified against
  Google's live JWKS (`worker/src/auth/google.ts`), session cookies signed
  with `jose` (HS256 JWT), 30-day expiry, `Secure` in production.
- **Access control** — `requireAuth`/`requireAdmin` middleware
  (`worker/src/auth/middleware.ts`) gates every per-user and admin route;
  `user_id` for every write always comes from the verified session, never
  from the request body.
- **Infra-level DDoS/WAF** — free once you put the app behind Cloudflare's
  proxy (DEPLOY.md step 10); Workers itself also has platform-level DDoS
  protection by default.
- **Secrets hygiene** — nothing sensitive lives in a committed file. Worker
  secrets are set via `wrangler secret put`; GitHub Actions secrets via repo
  settings; `.env`/`.env.example` only ever holds the local-scraper-testing
  values, and `.env` itself is gitignored.
- **Privacy policy** — `static/privacy.html` (linked from the sidebar and the
  cookie notice) covers what's collected, why, cookies used, where data is
  stored, and how to exercise GDPR rights. The "Contact" section is a
  placeholder — add a real contact address before onboarding people outside
  your trusted circle; GDPR requires a genuine channel for data-subject requests.
- **Cookie notice** — a dismissible banner (`static/app.js` `initCookieBanner`)
  discloses the two cookies in use (`springr_session`, `springr_oauth_state`),
  both strictly necessary (session + CSRF), so no consent gate is legally
  required under PECR/GDPR — this is a notice, not a consent wall. No
  analytics/advertising cookies exist to gate in the first place.
- **GDPR data export & account deletion** — `GET /api/account/export` (JSON
  download of everything an account has stored) and `DELETE /api/account`
  (permanently deletes the account, its D1 rows, and its R2 files) are wired
  up in the Documents page's profile panel ("Download my data" / "Delete my
  account").
- **Opportunities list gated behind sign-in** — `GET /api/opportunities`
  returns only a 3-item preview plus a total count to signed-out requests;
  the full catalog requires a session. Enforced server-side
  (`worker/src/routes/api.ts`), not just hidden in the UI — nothing beyond the
  preview is ever sent to a signed-out browser.

## Still worth doing before real users show up

- **Content-Security-Policy tightening** — `style-src` still needs
  `'unsafe-inline'` because `static/app.js`'s DOM writes weren't audited
  line-by-line for inline `style=` usage. Worth a pass to remove
  `unsafe-inline` and switch to nonces/hashes if the frontend doesn't
  actually need it.
- **Structured request logging** — Sentry catches errors, but there's no
  access-log/audit-log equivalent (who uploaded what, who was denied access to
  what document) — add if you need an audit trail beyond what the GDPR export
  endpoint already covers.
- **Backups** — D1 has point-in-time recovery on paid plans only; on the free
  tier, consider a periodic `wrangler d1 export` to somewhere durable (even a
  second R2 bucket) if the opportunity/user data ever becomes hard to
  regenerate. The scraped `opportunities` table is trivially rebuildable by
  re-running the scraper; `users`/`applications`/`documents` are not.
- **R2 lifecycle** — no automatic cleanup of orphaned R2 objects (e.g. if a
  D1 write fails after an R2 upload succeeds). Low risk at small scale; worth
  a periodic reconciliation job if storage usage becomes worth tracking.
- **Privacy policy contact address** — see above; currently a placeholder.
- **Load-test the rate limiter** — the D1-backed limiter is fine at low
  traffic but every check is a D1 round-trip; if usage grows into the
  thousands of requests/minute range, moving to a Durable Object or Cloudflare's
  built-in Rate Limiting (paid) would scale better.
- **GITHUB_TOKEN scope** — if you set this for the manual "trigger scrape now"
  admin button, use a fine-grained PAT scoped to just `Actions: write` on this
  one repo, not a broad classic token.

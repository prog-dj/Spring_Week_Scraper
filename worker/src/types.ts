export type Env = {
  DB: D1Database;
  DOCUMENTS: R2Bucket;
  ASSETS: Fetcher;
  AI: Ai;

  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  ADMIN_EMAILS: string;
  INGEST_SHARED_SECRET: string;

  // Interview Practice (paid feature): Stripe billing + Anthropic feedback.
  // Unset locally is fine during early dev, but the routes that need these
  // will fail loudly rather than silently misbehave -- see routes/billing.ts.
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID?: string;
  ANTHROPIC_API_KEY?: string;

  // Optional: Sentry error tracking. Unset locally so wrangler dev doesn't
  // report noise; set as a secret in production.
  SENTRY_DSN?: string;

  // "production" in the deployed environment; anything else (e.g. unset in
  // `wrangler dev`) is treated as local, same env-gated Secure-cookie pattern
  // the Flask config used.
  ENVIRONMENT?: string;
};

export type Variables = {
  user: AuthUser | null;
};

export type AuthUser = {
  id: number;
  google_sub: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  is_admin: number;
};

export type HonoEnv = {
  Bindings: Env;
  Variables: Variables;
};

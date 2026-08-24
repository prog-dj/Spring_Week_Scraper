import { Hono } from "hono";
import { withSentry } from "@sentry/cloudflare";
import type { HonoEnv, Env } from "./types";
import { loadCurrentUser, requireAuth, requireAdmin, requireSubscription } from "./auth/middleware";
import { authRoutes } from "./routes/auth";
import { apiRoutes } from "./routes/api";
import { workspaceRoutes } from "./routes/workspace";
import { applicationsRoutes } from "./routes/applications";
import { savedRoutes } from "./routes/saved";
import { documentsRoutes } from "./routes/documents";
import { adminRoutes } from "./routes/admin";
import { ingestRoutes } from "./routes/ingest";
import { accountRoutes } from "./routes/account";
import { billingRoutes } from "./routes/billing";
import { stripeWebhookRoutes } from "./routes/stripeWebhook";
import { interviewRoutes } from "./routes/interview";

const app = new Hono<HonoEnv>({ strict: false });

// Security headers on every response -- the Worker serves both the API and
// the frontend from one origin, so this is the app's whole XSS/clickjacking/
// MIME-sniffing surface, not just the API's.
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  // camera/microphone allowed for same-origin only -- needed for Interview
  // Practice's recording flow; everything else stays locked down.
  c.header("Permissions-Policy", "geolocation=(), microphone=(self), camera=(self)");
});

app.use("*", loadCurrentUser);

app.route("/auth", authRoutes);
app.route("/api", apiRoutes);
app.route("/api/workspace", new Hono<HonoEnv>({ strict: false }).use("*", requireAuth).route("/", workspaceRoutes));
app.route("/api/applications", new Hono<HonoEnv>({ strict: false }).use("*", requireAuth).route("/", applicationsRoutes));
app.route("/api/saved", new Hono<HonoEnv>({ strict: false }).use("*", requireAuth).route("/", savedRoutes));
app.route("/api/documents", new Hono<HonoEnv>({ strict: false }).use("*", requireAuth).route("/", documentsRoutes));
app.route("/api/account", new Hono<HonoEnv>({ strict: false }).use("*", requireAuth).route("/", accountRoutes));
app.route("/api/billing", new Hono<HonoEnv>({ strict: false }).use("*", requireAuth).route("/", billingRoutes));
app.route(
  "/api/interview",
  new Hono<HonoEnv>({ strict: false }).use("*", requireAuth).use("*", requireSubscription).route("/", interviewRoutes)
);
app.route("/api", new Hono<HonoEnv>({ strict: false }).use("*", requireAdmin).route("/", adminRoutes));
app.route("/internal/ingest", ingestRoutes);
app.route("/internal/stripe/webhook", stripeWebhookRoutes);

// Anything else falls through to the static frontend (static/index.html,
// app.js, styles.css) via the Workers Static Assets binding.
app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal server error" }, 500);
});

// SENTRY_DSN is optional -- if unset, withSentry no-ops and errors just go to
// the Worker's own console/tail logs instead.
export default withSentry(
  (env: Env) => ({
    dsn: env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    environment: env.ENVIRONMENT || "development",
  }),
  app
);

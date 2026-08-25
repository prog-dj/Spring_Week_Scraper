import { Hono } from "hono";
import type { HonoEnv } from "../types";
import { storedOpportunities, statusHistory, seedFailureRows, utcNow } from "../db/opportunities";
import { hasActiveSubscription } from "../db/subscriptions";

// Public, read-only endpoints -- no login required. Mirrors the old Flask
// api/routes.py so the existing frontend keeps working unchanged.
export const apiRoutes = new Hono<HonoEnv>({ strict: false });

apiRoutes.get("/health", async (c) => {
  // Scraping itself (Serper, Playwright) now runs out-of-band in GitHub
  // Actions, not in the Worker -- so "is scraping configured" isn't something
  // this endpoint can answer directly. Its own health is just "can I reach D1."
  try {
    await c.env.DB.prepare("SELECT 1").first();
    return c.json({ ok: true, service: "springr-api", dbReachable: true });
  } catch (err) {
    return c.json({ ok: false, service: "springr-api", dbReachable: false, error: String(err) }, 503);
  }
});

apiRoutes.get("/session", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ authenticated: false });
  return c.json({
    authenticated: true,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatar_url,
    isAdmin: Boolean(user.is_admin),
    hasInterviewPracticeSubscription: await hasActiveSubscription(c.env, user.id),
  });
});

// The full catalog is a sign-in perk -- signed-out visitors get a small
// preview plus a total count, not the whole list. Enforced server-side (not
// just hidden in the UI) since anything sent to the browser is visible
// regardless of CSS.
const ANONYMOUS_PREVIEW_COUNT = 3;

apiRoutes.get("/opportunities", async (c) => {
  const opportunities = await storedOpportunities(c.env, "spring_week");
  const user = c.get("user");
  const authenticated = Boolean(user);
  const visible = authenticated ? opportunities : opportunities.slice(0, ANONYMOUS_PREVIEW_COUNT);
  return c.json({
    opportunities: visible,
    checkedAt: utcNow(),
    source: "d1",
    authenticated,
    totalCount: opportunities.length,
  });
});

apiRoutes.get("/history", async (c) => {
  const history = await statusHistory(c.env, c.req.query("opportunity_id") ?? null);
  return c.json({ history });
});

apiRoutes.get("/seed-health", async (c) => {
  const failures = await seedFailureRows(c.env);
  return c.json({ failures });
});

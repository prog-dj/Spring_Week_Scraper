import { Hono } from "hono";
import type { HonoEnv } from "../types";
import { storedOpportunities, utcNow } from "../db/opportunities";

// A wholly separate feed from spring-week opportunities -- always queries
// category "degree_apprenticeship" explicitly, never the default. Mirrors
// api.ts's /opportunities endpoint exactly (same anonymous-preview gating,
// same response shape) so the frontend can reuse the same rendering
// mechanics for both feeds.
export const degreeApprenticeshipRoutes = new Hono<HonoEnv>({ strict: false });

const ANONYMOUS_PREVIEW_COUNT = 3;

degreeApprenticeshipRoutes.get("/", async (c) => {
  const opportunities = await storedOpportunities(c.env, "degree_apprenticeship");
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

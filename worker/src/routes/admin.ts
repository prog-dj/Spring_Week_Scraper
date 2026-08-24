import { Hono } from "hono";
import type { HonoEnv } from "../types";

// The scraper runs on its own GitHub Actions schedule (twice daily -- see
// .github/workflows/scrape.yml) and is never triggerable from here. There
// used to be a manual "trigger a scrape now" endpoint, but each run spends
// real Serper API credit, so it was removed to rule out an accidental click
// causing unwanted spend -- the scheduled run is the only way a scrape fires.
export const adminRoutes = new Hono<HonoEnv>({ strict: false });

adminRoutes.get("/admin/stats", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM users) AS userCount,
       (SELECT COUNT(*) FROM opportunities) AS opportunityCount,
       (SELECT COUNT(*) FROM applications) AS applicationCount,
       (SELECT COUNT(*) FROM documents) AS documentCount`
  ).first<{ userCount: number; opportunityCount: number; applicationCount: number; documentCount: number }>();
  return c.json(row);
});

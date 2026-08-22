import { Hono } from "hono";
import type { HonoEnv } from "../types";

// The scraper itself no longer runs inside the Worker (Playwright needs a real
// browser + subprocess support, which Workers doesn't have) -- it runs on a
// schedule in GitHub Actions. This just lets an admin manually kick that
// workflow early via GitHub's API, replacing the old direct
// discover_and_refresh() call. Each run still costs real Serper API calls, so
// it stays admin-only.
export const adminRoutes = new Hono<HonoEnv>({ strict: false });

adminRoutes.get("/discover", async (c) => dispatchScrapeWorkflow(c.env));
adminRoutes.get("/opportunities/refresh", async (c) => dispatchScrapeWorkflow(c.env));

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

async function dispatchScrapeWorkflow(env: {
  GITHUB_TOKEN?: string;
  GITHUB_REPO?: string;
  GITHUB_WORKFLOW_FILE?: string;
}) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return Response.json(
      { error: "manual trigger not configured (GITHUB_TOKEN/GITHUB_REPO secrets unset) -- the scheduled run will still fire on its normal cron" },
      { status: 501 }
    );
  }
  const workflowFile = env.GITHUB_WORKFLOW_FILE || "scrape.yml";
  const response = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${workflowFile}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "springr-worker",
      },
      body: JSON.stringify({ ref: "main" }),
    }
  );
  if (!response.ok) {
    return Response.json({ error: `GitHub dispatch failed: ${response.status} ${await response.text()}` }, { status: 502 });
  }
  return Response.json({ status: "triggered" });
}

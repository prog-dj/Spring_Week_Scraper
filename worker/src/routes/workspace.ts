import { Hono } from "hono";
import type { HonoEnv } from "../types";
import { opportunityExists } from "../db/opportunities";
import { getWorkspace, saveWorkspace } from "../db/workspace";

export const workspaceRoutes = new Hono<HonoEnv>({ strict: false });

workspaceRoutes.get("/", async (c) => {
  const opportunityId = c.req.query("opportunity_id");
  if (!opportunityId) return c.json({ error: "opportunity_id is required" }, 400);
  const user = c.get("user")!;
  return c.json({ workspace: await getWorkspace(c.env, user.id, opportunityId) });
});

workspaceRoutes.post("/", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const opportunityId = body.opportunity_id as string | undefined;
  delete body.opportunity_id;
  if (!opportunityId) return c.json({ error: "opportunity_id is required" }, 400);
  if (!(await opportunityExists(c.env, opportunityId))) {
    return c.json({ error: "unknown opportunity_id" }, 400);
  }
  const user = c.get("user")!;
  return c.json({ workspace: await saveWorkspace(c.env, user.id, opportunityId, body) });
});

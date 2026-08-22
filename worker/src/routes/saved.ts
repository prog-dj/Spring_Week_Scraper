import { Hono } from "hono";
import type { HonoEnv } from "../types";
import { addSaved, listSaved, removeSaved } from "../db/saved";
import { opportunityExists } from "../db/opportunities";

export const savedRoutes = new Hono<HonoEnv>({ strict: false });

savedRoutes.get("/", async (c) => {
  const user = c.get("user")!;
  return c.json({ saved: await listSaved(c.env, user.id) });
});

savedRoutes.post("/", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const opportunityId = body.opportunity_id as string | undefined;
  if (!opportunityId) return c.json({ error: "opportunity_id is required" }, 400);
  if (!(await opportunityExists(c.env, opportunityId))) {
    return c.json({ error: "unknown opportunity_id" }, 400);
  }
  const user = c.get("user")!;
  await addSaved(c.env, user.id, opportunityId);
  return c.json({ ok: true });
});

savedRoutes.delete("/:opportunity_id", async (c) => {
  const user = c.get("user")!;
  await removeSaved(c.env, user.id, c.req.param("opportunity_id"));
  return c.json({ ok: true });
});

import { Hono } from "hono";
import type { HonoEnv } from "../types";
import { deleteApplication, listApplications, upsertApplication } from "../db/applications";
import { opportunityExists } from "../db/opportunities";

export const applicationsRoutes = new Hono<HonoEnv>({ strict: false });

applicationsRoutes.get("/", async (c) => {
  const user = c.get("user")!;
  return c.json({ applications: await listApplications(c.env, user.id) });
});

applicationsRoutes.post("/", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const opportunityId = body.opportunity_id as string | undefined;
  if (!opportunityId) return c.json({ error: "opportunity_id is required" }, 400);
  if (!(await opportunityExists(c.env, opportunityId))) {
    return c.json({ error: "unknown opportunity_id" }, 400);
  }
  const user = c.get("user")!;
  try {
    const application = await upsertApplication(
      c.env,
      user.id,
      opportunityId,
      (body.status as string) ?? "Saved",
      (body.next_action as string) ?? null,
      (body.progress as number) ?? 0
    );
    return c.json({ application });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "invalid request" }, 400);
  }
});

applicationsRoutes.delete("/:opportunity_id", async (c) => {
  const user = c.get("user")!;
  await deleteApplication(c.env, user.id, c.req.param("opportunity_id"));
  return c.json({ ok: true });
});

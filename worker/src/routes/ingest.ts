import { Hono } from "hono";
import type { HonoEnv } from "../types";
import {
  cleanupStaleOpportunities,
  purgeExpiredOpportunities,
  recordDiscoveryError,
  recordDiscoveryRun,
  recordSeedFailures,
  upsertOpportunity,
  utcNow,
} from "../db/opportunities";

// Pushed to by the GitHub Actions scraper workflow (see .github/workflows/scrape.yml)
// instead of writing to a local sqlite3 file directly -- the scraping engine
// itself (scraping/discovery.py etc.) is unchanged; only its persistence layer
// now goes over HTTP. Authenticated via a shared secret, never a user session.
export const ingestRoutes = new Hono<HonoEnv>({ strict: false });

type IngestPayload = {
  startedAt: string;
  queryCount: number;
  candidateCount: number;
  verified: Record<string, unknown>[];
  seedFailures: { company: string; careers_url: string; error: string }[];
  error?: string;
};

ingestRoutes.post("/", async (c) => {
  const providedSecret = c.req.header("X-Ingest-Secret");
  if (!providedSecret || providedSecret !== c.env.INGEST_SHARED_SECRET) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const payload = await c.req.json<IngestPayload>().catch(() => null);
  if (!payload) return c.json({ error: "invalid JSON body" }, 400);

  if (payload.error) {
    await recordDiscoveryError(c.env, payload.startedAt, utcNow(), payload.queryCount, payload.error);
    return c.json({ status: "error_recorded" });
  }

  for (const item of payload.verified ?? []) {
    await upsertOpportunity(c.env, item);
  }
  const verifiedIds = (payload.verified ?? []).map((item) => item.id as string);
  await cleanupStaleOpportunities(c.env, verifiedIds);
  const purged = await purgeExpiredOpportunities(c.env);
  await recordDiscoveryRun(
    c.env,
    payload.startedAt,
    utcNow(),
    payload.queryCount,
    payload.candidateCount,
    (payload.verified ?? []).length
  );
  await recordSeedFailures(c.env, payload.seedFailures ?? []);

  return c.json({
    status: "complete",
    candidates: payload.candidateCount,
    verified: (payload.verified ?? []).length,
    seedFailures: (payload.seedFailures ?? []).length,
    expiredPurged: purged,
    checkedAt: utcNow(),
  });
});

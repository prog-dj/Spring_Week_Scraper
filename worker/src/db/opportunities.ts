import type { Env } from "../types";

export function utcNow(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "+00:00");
}

// Career-page URLs are frequently discovered years after a programme has
// closed. Rather than delete an expired opportunity the moment its deadline
// passes, it gets a grace window before hard deletion, while disappearing
// from the discovery feed immediately -- see stored_opportunities' filter.
export const EXPIRED_GRACE_DAYS = 30;

export type OpportunityRow = Record<string, unknown> & {
  id: string;
  status: string;
  deadline: string | null;
  evidence: string | null;
  company: string;
  programme: string;
  source_url: string;
  logo_class: string | null;
  opportunity_type: string | null;
  application_process: string | null;
  eligibility: string | null;
};

export async function upsertOpportunity(env: Env, item: Record<string, unknown>): Promise<void> {
  const old = await env.DB.prepare("SELECT status FROM opportunities WHERE id = ?")
    .bind(item.id)
    .first<{ status: string }>();

  await env.DB.prepare(
    `INSERT INTO opportunities (id, company, programme, sector, location, opportunity_url, source_url, discovered_via, deadline, programme_dates, status, confidence, evidence, application_process, eligibility, format, http_status, checked_at, last_error, logo, logo_class, opportunity_type, source_type, evidence_excerpt, prep_tags)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25)
     ON CONFLICT(id) DO UPDATE SET company=excluded.company, programme=excluded.programme, sector=excluded.sector, location=excluded.location, deadline=excluded.deadline, programme_dates=excluded.programme_dates, status=excluded.status, confidence=excluded.confidence, evidence=excluded.evidence, application_process=excluded.application_process, eligibility=excluded.eligibility, format=excluded.format, http_status=excluded.http_status, checked_at=excluded.checked_at, last_error=excluded.last_error, logo=excluded.logo, logo_class=excluded.logo_class, opportunity_type=excluded.opportunity_type, source_type=excluded.source_type, evidence_excerpt=excluded.evidence_excerpt, prep_tags=excluded.prep_tags`
  )
    .bind(
      item.id, item.company, item.programme, item.sector ?? null, item.location ?? null,
      item.opportunity_url, item.source_url, item.discovered_via, item.deadline ?? null,
      item.programme_dates ?? null, item.status, item.confidence, item.evidence ?? null,
      item.application_process ?? null, item.eligibility ?? null, item.format ?? null,
      item.http_status ?? null, item.checked_at, item.last_error ?? null, item.logo ?? null,
      item.logo_class ?? null, item.opportunity_type ?? null, item.source_type ?? "unknown",
      item.evidence_excerpt ?? null, item.prep_tags ?? null
    )
    .run();

  if (!old || old.status !== item.status) {
    await env.DB.prepare(
      "INSERT INTO status_history (opportunity_id, status, evidence, observed_at) VALUES (?, ?, ?, ?)"
    )
      .bind(item.id, item.status, item.evidence ?? null, item.checked_at)
      .run();
    // The old Flask app also emailed an alert here (send_status_alert, via SMTP
    // env vars). Not ported: Sentry is the chosen observability path for this
    // rewrite instead of ad-hoc SMTP alerting.
  }
}

async function untrackedIds(env: Env, candidateIds: string[]): Promise<string[]> {
  if (candidateIds.length === 0) return [];
  const placeholders = candidateIds.map(() => "?").join(",");
  const tracked = new Set<string>();
  for (const table of ["applications", "saved_opportunities", "application_workspaces"]) {
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT opportunity_id FROM ${table} WHERE opportunity_id IN (${placeholders})`
    )
      .bind(...candidateIds)
      .all<{ opportunity_id: string }>();
    for (const row of results) tracked.add(row.opportunity_id);
  }
  return candidateIds.filter((id) => !tracked.has(id));
}

async function deleteOpportunities(env: Env, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(",");
  await env.DB.prepare(`DELETE FROM status_history WHERE opportunity_id IN (${placeholders})`)
    .bind(...ids)
    .run();
  await env.DB.prepare(`DELETE FROM opportunities WHERE id IN (${placeholders})`)
    .bind(...ids)
    .run();
  return ids.length;
}

export async function cleanupStaleOpportunities(env: Env, currentIds: string[]): Promise<number> {
  let staleIds: string[];
  if (currentIds.length > 0) {
    const placeholders = currentIds.map(() => "?").join(",");
    const { results } = await env.DB.prepare(`SELECT id FROM opportunities WHERE id NOT IN (${placeholders})`)
      .bind(...currentIds)
      .all<{ id: string }>();
    staleIds = results.map((r) => r.id);
  } else {
    const { results } = await env.DB.prepare("SELECT id FROM opportunities").all<{ id: string }>();
    staleIds = results.map((r) => r.id);
  }
  return deleteOpportunities(env, await untrackedIds(env, staleIds));
}

export async function purgeExpiredOpportunities(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(
    "SELECT id FROM opportunities WHERE deadline IS NOT NULL AND deadline < date('now', ?)"
  )
    .bind(`-${EXPIRED_GRACE_DAYS} days`)
    .all<{ id: string }>();
  return deleteOpportunities(env, await untrackedIds(env, results.map((r) => r.id)));
}

export async function recordDiscoveryRun(
  env: Env,
  startedAt: string,
  finishedAt: string,
  queryCount: number,
  resultCount: number,
  verifiedCount: number
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO discovery_runs (started_at, finished_at, query_count, result_count, verified_count) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(startedAt, finishedAt, queryCount, resultCount, verifiedCount)
    .run();
}

export async function recordDiscoveryError(
  env: Env,
  startedAt: string,
  finishedAt: string,
  queryCount: number,
  error: string
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO discovery_runs (started_at, finished_at, query_count, error) VALUES (?, ?, ?, ?)"
  )
    .bind(startedAt, finishedAt, queryCount, error)
    .run();
}

export async function recordSeedFailures(
  env: Env,
  failures: { company: string; careers_url: string; error: string }[]
): Promise<void> {
  await env.DB.prepare("DELETE FROM seed_failures").run();
  const checkedAt = utcNow();
  for (const f of failures) {
    await env.DB.prepare(
      "INSERT INTO seed_failures (company, careers_url, error, checked_at) VALUES (?, ?, ?, ?)"
    )
      .bind(f.company, f.careers_url, f.error, checkedAt)
      .run();
  }
}

export async function opportunityExists(env: Env, id: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT 1 FROM opportunities WHERE id = ?").bind(id).first();
  return row !== null;
}

function parseList(raw: string | null): unknown[] | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function storedOpportunities(env: Env): Promise<Record<string, unknown>[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM opportunities WHERE deadline IS NULL OR deadline >= date('now', ?)
     ORDER BY CASE status WHEN 'open' THEN 1 WHEN 'upcoming' THEN 2 WHEN 'unknown' THEN 3 ELSE 4 END, deadline IS NULL, deadline`
  )
    .bind(`-${EXPIRED_GRACE_DAYS} days`)
    .all<OpportunityRow>();

  return results.map((item) => ({
    ...item,
    firm: item.company,
    role: item.programme,
    url: item.source_url,
    source: item.evidence || item.source_url,
    logoClass: item.logo_class,
    type: item.opportunity_type,
    application_process: parseList(item.application_process),
    eligibility: parseList(item.eligibility),
  }));
}

export async function statusHistory(env: Env, opportunityId: string | null): Promise<Record<string, unknown>[]> {
  if (opportunityId) {
    const { results } = await env.DB.prepare(
      "SELECT * FROM status_history WHERE opportunity_id = ? ORDER BY observed_at DESC LIMIT 50"
    )
      .bind(opportunityId)
      .all();
    return results;
  }
  const { results } = await env.DB.prepare("SELECT * FROM status_history ORDER BY observed_at DESC LIMIT 200").all();
  return results;
}

export async function seedFailureRows(env: Env): Promise<Record<string, unknown>[]> {
  const { results } = await env.DB.prepare(
    "SELECT company, careers_url, error, checked_at FROM seed_failures ORDER BY company"
  ).all();
  return results;
}

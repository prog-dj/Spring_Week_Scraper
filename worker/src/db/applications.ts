import type { Env } from "../types";
import { utcNow } from "./opportunities";

// The lifecycle a tracked application can move through. Ordered roughly as
// it plays out; Rejected/No Response/Withdrawn are terminal branches rather
// than a strict "next step" -- the UI lets a user jump straight to any of
// them, not just advance one step at a time.
export const VALID_STATUSES = [
  "Saved",
  "Applied",
  "Online Assessment",
  "Interview",
  "Offer",
  "Rejected",
  "No Response",
  "Withdrawn",
] as const;

export async function listApplications(env: Env, userId: number): Promise<Record<string, unknown>[]> {
  const { results } = await env.DB.prepare(
    `SELECT a.*, o.company, o.programme, o.opportunity_url, o.deadline, o.status AS opportunity_status
     FROM applications a JOIN opportunities o ON o.id = a.opportunity_id
     WHERE a.user_id = ? ORDER BY a.updated_at DESC`
  )
    .bind(userId)
    .all();
  return results;
}

export async function upsertApplication(
  env: Env,
  userId: number,
  opportunityId: string,
  status: string,
  nextAction: string | null,
  progress: number
): Promise<Record<string, unknown>> {
  if (!VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
    throw new Error(`invalid status: ${status}`);
  }
  const now = utcNow();
  await env.DB.prepare(
    `INSERT INTO applications (user_id, opportunity_id, status, next_action, progress, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, opportunity_id) DO UPDATE SET status=excluded.status, next_action=excluded.next_action, progress=excluded.progress, updated_at=excluded.updated_at`
  )
    .bind(userId, opportunityId, status, nextAction, progress, now, now)
    .run();
  const row = await env.DB.prepare("SELECT * FROM applications WHERE user_id = ? AND opportunity_id = ?")
    .bind(userId, opportunityId)
    .first();
  if (!row) throw new Error("application upsert did not persist");
  return row;
}

export async function deleteApplication(env: Env, userId: number, opportunityId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM applications WHERE user_id = ? AND opportunity_id = ?")
    .bind(userId, opportunityId)
    .run();
}

export type ApplicationOutcomes = {
  totalApplications: number;
  byStatus: { status: string; count: number }[];
  offersByCompany: { company: string; count: number }[];
};

// Powers the Outcomes Sankey view -- only ever the signed-in user's own
// applications, aggregated by their current status (we don't track full
// status-transition history per application, so this reflects "where things
// stand now," not a replay of every stage each application passed through).
export async function getApplicationOutcomes(env: Env, userId: number): Promise<ApplicationOutcomes> {
  const [statusRows, offerRows] = await Promise.all([
    env.DB.prepare("SELECT status, COUNT(*) AS count FROM applications WHERE user_id = ? GROUP BY status")
      .bind(userId)
      .all<{ status: string; count: number }>(),
    env.DB.prepare(
      `SELECT o.company AS company, COUNT(*) AS count FROM applications a
       JOIN opportunities o ON o.id = a.opportunity_id
       WHERE a.user_id = ? AND a.status = 'Offer' GROUP BY o.company`
    )
      .bind(userId)
      .all<{ company: string; count: number }>(),
  ]);

  const totalApplications = statusRows.results.reduce((sum, row) => sum + row.count, 0);
  return {
    totalApplications,
    byStatus: statusRows.results,
    offersByCompany: offerRows.results,
  };
}

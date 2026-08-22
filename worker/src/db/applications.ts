import type { Env } from "../types";
import { utcNow } from "./opportunities";

export const VALID_STATUSES = ["Saved", "To apply", "In progress", "Submitted"] as const;

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

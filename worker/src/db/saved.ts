import type { Env } from "../types";
import { utcNow } from "./opportunities";

export async function listSaved(env: Env, userId: number): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT opportunity_id FROM saved_opportunities WHERE user_id = ?")
    .bind(userId)
    .all<{ opportunity_id: string }>();
  return results.map((r) => r.opportunity_id);
}

export async function addSaved(env: Env, userId: number, opportunityId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO saved_opportunities (user_id, opportunity_id, created_at) VALUES (?, ?, ?)"
  )
    .bind(userId, opportunityId, utcNow())
    .run();
}

export async function removeSaved(env: Env, userId: number, opportunityId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM saved_opportunities WHERE user_id = ? AND opportunity_id = ?")
    .bind(userId, opportunityId)
    .run();
}

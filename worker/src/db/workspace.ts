import type { Env } from "../types";
import { utcNow } from "./opportunities";

export function defaultWorkspace(opportunityId: string): Record<string, unknown> {
  return {
    opportunity_id: opportunityId,
    eligibility: [
      { label: "Check year-group eligibility", complete: false },
      { label: "Check right-to-work requirements", complete: false },
      { label: "Check location and programme dates", complete: false },
    ],
    required_documents: [
      { label: "CV", document_id: null, complete: false },
      { label: "Cover letter", document_id: null, complete: false },
      { label: "Transcript", document_id: null, complete: false },
    ],
    cv_document_id: null,
    cover_letter_document_id: null,
    oa_plan: ["Complete numerical reasoning drill", "Complete situational judgement drill"],
    interview_questions: [
      "Why this firm?",
      "Why this programme?",
      "Tell me about a time you solved a difficult problem.",
    ],
    reminder_enabled: false,
    reminder_date: null,
    notes: "",
    submission_evidence: null,
    status: "Saved",
  };
}

export async function getWorkspace(env: Env, userId: number, opportunityId: string): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare(
    "SELECT payload FROM application_workspaces WHERE user_id = ? AND opportunity_id = ?"
  )
    .bind(userId, opportunityId)
    .first<{ payload: string }>();
  return row ? JSON.parse(row.payload) : defaultWorkspace(opportunityId);
}

export async function saveWorkspace(
  env: Env,
  userId: number,
  opportunityId: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  payload.opportunity_id = opportunityId;
  const updatedAt = utcNow();
  await env.DB.prepare(
    `INSERT INTO application_workspaces (user_id, opportunity_id, payload, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, opportunity_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at`
  )
    .bind(userId, opportunityId, JSON.stringify(payload), updatedAt)
    .run();
  payload.updated_at = updatedAt;
  return payload;
}

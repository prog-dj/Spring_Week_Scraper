import type { Env } from "../types";
import { utcNow } from "./opportunities";

export type InterviewAttempt = {
  id: number;
  user_id: number;
  question: string;
  transcript: string | null;
  duration_seconds: number | null;
  words_per_minute: number | null;
  filler_word_count: number | null;
  llm_feedback: string | null;
  created_at: string;
};

export async function createAttempt(
  env: Env,
  userId: number,
  fields: {
    question: string;
    transcript: string;
    durationSeconds: number;
    wordsPerMinute: number;
    fillerWordCount: number;
    llmFeedback: string;
  }
): Promise<InterviewAttempt> {
  const now = utcNow();
  const result = await env.DB.prepare(
    `INSERT INTO interview_attempts (user_id, question, transcript, duration_seconds, words_per_minute, filler_word_count, llm_feedback, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(userId, fields.question, fields.transcript, fields.durationSeconds, fields.wordsPerMinute, fields.fillerWordCount, fields.llmFeedback, now)
    .run();
  const row = await env.DB.prepare("SELECT * FROM interview_attempts WHERE id = ?")
    .bind(result.meta.last_row_id)
    .first<InterviewAttempt>();
  if (!row) throw new Error("interview attempt insert did not persist");
  return row;
}

export async function listAttempts(env: Env, userId: number): Promise<InterviewAttempt[]> {
  const { results } = await env.DB.prepare("SELECT * FROM interview_attempts WHERE user_id = ? ORDER BY created_at DESC")
    .bind(userId)
    .all<InterviewAttempt>();
  return results;
}

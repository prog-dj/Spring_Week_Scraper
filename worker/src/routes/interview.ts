import { Hono } from "hono";
import type { HonoEnv } from "../types";
import { questionsForSector } from "../interview/questions";
import { computeDeliveryMetrics } from "../interview/metrics";
import { getLlmFeedback } from "../interview/feedback";
import { createAttempt, listAttempts } from "../db/interviewAttempts";
import { checkRateLimit, peekRateLimit } from "../storage/rateLimit";

export const interviewRoutes = new Hono<HonoEnv>({ strict: false });

const MAX_AUDIO_BYTES = 15 * 1024 * 1024; // audio-only, a couple of minutes of compressed speech comfortably fits
const DAILY_ATTEMPT_LIMIT = 15; // cheap insurance against scripted abuse -- normal usage never comes close

interviewRoutes.get("/questions", (c) => {
  const sector = c.req.query("sector") || null;
  return c.json({ questions: questionsForSector(sector) });
});

interviewRoutes.get("/attempts", async (c) => {
  const user = c.get("user")!;
  return c.json({ attempts: await listAttempts(c.env, user.id) });
});

// Lets the frontend check/display remaining quota *before* committing to a
// full prep-countdown-and-record flow, rather than only discovering the cap
// is hit after wasting the user's time recording an answer.
interviewRoutes.get("/limit-status", async (c) => {
  const user = c.get("user")!;
  const status = await peekRateLimit(c.env, `interview:${user.id}`, {
    limit: DAILY_ATTEMPT_LIMIT,
    windowSeconds: 60 * 60 * 24,
  });
  return c.json(status);
});

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Response shapes for @cf/openai/whisper-large-v3-turbo have varied across
// versions of Cloudflare's docs (top-level `text` vs `transcription_info.text`)
// -- read defensively rather than assume one exact shape.
function extractTranscript(result: unknown): string {
  const r = result as { text?: string; transcription_info?: { text?: string } };
  return r.text ?? r.transcription_info?.text ?? "";
}

interviewRoutes.post("/attempts", async (c) => {
  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: "interview feedback is not configured" }, 501);
  }

  const user = c.get("user")!;
  const { allowed, retryAfterSeconds } = await checkRateLimit(c.env, `interview:${user.id}`, {
    limit: DAILY_ATTEMPT_LIMIT,
    windowSeconds: 60 * 60 * 24,
  });
  if (!allowed) {
    return c.json(
      { error: `you've hit today's limit of ${DAILY_ATTEMPT_LIMIT} practice questions -- try again tomorrow` },
      429,
      { "Retry-After": String(retryAfterSeconds ?? 86400) }
    );
  }

  const contentType = c.req.header("Content-Type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return c.json({ error: "expected multipart/form-data upload" }, 400);
  }

  const form = await c.req.formData();
  const audio = form.get("audio");
  const question = form.get("question");
  const durationSeconds = Number(form.get("duration_seconds"));

  if (!(audio instanceof File) || typeof question !== "string" || !question.trim()) {
    return c.json({ error: "audio and question are required" }, 400);
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return c.json({ error: "a valid duration_seconds is required" }, 400);
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return c.json({ error: "recording exceeds the size limit" }, 413);
  }
  if (audio.size === 0) {
    return c.json({ error: "recording is empty" }, 400);
  }

  try {
    const audioBuffer = await audio.arrayBuffer();
    const transcriptionResult = await c.env.AI.run("@cf/openai/whisper-large-v3-turbo", {
      audio: arrayBufferToBase64(audioBuffer),
    });
    const transcript = extractTranscript(transcriptionResult).trim();
    if (!transcript) {
      return c.json({ error: "could not transcribe the recording -- try again" }, 422);
    }

    const { wordsPerMinute, fillerWordCount, confidenceScore } = computeDeliveryMetrics(transcript, durationSeconds);
    const llmResult = await getLlmFeedback(c.env.ANTHROPIC_API_KEY, question, transcript);
    const overallScore = Math.round(((confidenceScore + llmResult.contentRelevancyScore + llmResult.breadthScore) / 3) * 10) / 10;

    const attempt = await createAttempt(c.env, user.id, {
      question,
      transcript,
      durationSeconds: Math.round(durationSeconds),
      wordsPerMinute,
      fillerWordCount,
      confidenceScore,
      contentRelevancyScore: llmResult.contentRelevancyScore,
      breadthScore: llmResult.breadthScore,
      overallScore,
      llmFeedback: JSON.stringify({
        strengths: llmResult.strengths,
        areasToStrengthen: llmResult.areasToStrengthen,
        bottomLine: llmResult.bottomLine,
      }),
    });

    // The audio itself (audioBuffer/File) is never written anywhere -- it
    // simply falls out of scope here and is garbage collected.
    return c.json({ attempt });
  } catch (err) {
    console.error("Interview attempt processing failed", err);
    return c.json({ error: "could not process this recording, please try again" }, 502);
  }
});

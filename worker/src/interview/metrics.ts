// Deterministic delivery metrics from a transcript -- no LLM involved, cheap
// and consistent. Complements (not replaces) the qualitative LLM feedback.
const FILLER_WORDS = ["um", "uh", "like", "you know", "sort of", "kind of", "basically", "actually", "so yeah"];

// Roughly the range real interview coaches target for spoken answers --
// comfortably paced, not rushed, not dragging.
const IDEAL_WPM_MIN = 120;
const IDEAL_WPM_MAX = 160;

function computeConfidenceScore(wordsPerMinute: number, fillerWordCount: number, wordCount: number): number {
  const paceDistance = wordsPerMinute < IDEAL_WPM_MIN ? IDEAL_WPM_MIN - wordsPerMinute : Math.max(0, wordsPerMinute - IDEAL_WPM_MAX);
  const paceScore = Math.max(0, 10 - paceDistance / 10);

  const fillerRatePer100Words = wordCount > 0 ? (fillerWordCount / wordCount) * 100 : 0;
  const fillerScore = Math.max(0, 10 - fillerRatePer100Words * 2);

  return Math.round(((paceScore + fillerScore) / 2) * 10) / 10;
}

export function computeDeliveryMetrics(
  transcript: string,
  durationSeconds: number
): { wordsPerMinute: number; fillerWordCount: number; confidenceScore: number } {
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  const wordsPerMinute = durationSeconds > 0 ? Math.round((words.length / durationSeconds) * 60) : 0;

  const lowered = transcript.toLowerCase();
  const fillerWordCount = FILLER_WORDS.reduce((count, filler) => {
    const matches = lowered.match(new RegExp(`\\b${filler.replace(/\s+/g, "\\s+")}\\b`, "g"));
    return count + (matches?.length ?? 0);
  }, 0);

  return {
    wordsPerMinute,
    fillerWordCount,
    confidenceScore: computeConfidenceScore(wordsPerMinute, fillerWordCount, words.length),
  };
}

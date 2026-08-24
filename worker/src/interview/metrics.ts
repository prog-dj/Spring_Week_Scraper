// Deterministic delivery metrics from a transcript -- no LLM involved, cheap
// and consistent. Complements (not replaces) the qualitative LLM feedback.
const FILLER_WORDS = ["um", "uh", "like", "you know", "sort of", "kind of", "basically", "actually", "so yeah"];

export function computeDeliveryMetrics(
  transcript: string,
  durationSeconds: number
): { wordsPerMinute: number; fillerWordCount: number } {
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  const wordsPerMinute = durationSeconds > 0 ? Math.round((words.length / durationSeconds) * 60) : 0;

  const lowered = transcript.toLowerCase();
  const fillerWordCount = FILLER_WORDS.reduce((count, filler) => {
    const matches = lowered.match(new RegExp(`\\b${filler.replace(/\s+/g, "\\s+")}\\b`, "g"));
    return count + (matches?.length ?? 0);
  }, 0);

  return { wordsPerMinute, fillerWordCount };
}

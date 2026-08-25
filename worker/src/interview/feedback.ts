// Qualitative content feedback on an interview answer, via the Anthropic
// Messages API directly (no SDK -- a single fetch call, same pattern as the
// hand-rolled Stripe client in routes/billing.ts).
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"; // fast/cheap is the right tradeoff for a per-attempt feedback call

export type LlmFeedbackResult = {
  contentRelevancyScore: number; // 0-10, how directly the answer addresses the question asked
  breadthScore: number; // 0-10, depth/breadth of relevant knowledge and specifics demonstrated
  strengths: string[];
  areasToStrengthen: string[];
  bottomLine: string;
};

function clampScore(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, Math.round(n)));
}

export async function getLlmFeedback(apiKey: string, question: string, transcript: string): Promise<LlmFeedbackResult> {
  const prompt = `You are an interview coach reviewing a spoken answer to a mock interview question.

Question: "${question}"
Answer transcript: "${transcript}"

Score the CONTENT of this answer (not delivery, pacing, or filler words -- those are assessed separately) on two dimensions, each an integer from 0-10:
- contentRelevancyScore: how directly and specifically the answer addresses the actual question asked
- breadthScore: how much relevant knowledge, specific detail, and insight the answer demonstrates

Then give brief written feedback: 2-3 strengths and 2-3 areas to strengthen, each ONE specific sentence, plus one bottom-line sentence summarizing what to focus on next.

If the answer is too short or off-topic to assess meaningfully, score both dimensions low and say so plainly in bottomLine rather than inventing praise.

Respond with ONLY valid JSON, no markdown code fences, no commentary, matching exactly this shape:
{"contentRelevancyScore": 0, "breadthScore": 0, "strengths": ["..."], "areasToStrengthen": ["..."], "bottomLine": "..."}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as { content?: { type: string; text?: string }[] };
  const text = data.content?.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("Anthropic API returned no text content");

  // Claude generally follows "no code fences" instructions, but strip them
  // defensively rather than let a wrapped response fail JSON.parse outright.
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("Anthropic API returned unparseable feedback");
  }

  return {
    contentRelevancyScore: clampScore(parsed.contentRelevancyScore),
    breadthScore: clampScore(parsed.breadthScore),
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.filter((s): s is string => typeof s === "string") : [],
    areasToStrengthen: Array.isArray(parsed.areasToStrengthen)
      ? parsed.areasToStrengthen.filter((s): s is string => typeof s === "string")
      : [],
    bottomLine: typeof parsed.bottomLine === "string" ? parsed.bottomLine : "",
  };
}

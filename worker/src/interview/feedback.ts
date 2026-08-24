// Qualitative content feedback on an interview answer, via the Anthropic
// Messages API directly (no SDK -- a single fetch call, same pattern as the
// hand-rolled Stripe client in routes/billing.ts).
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"; // fast/cheap is the right tradeoff for a per-attempt feedback call

export async function getLlmFeedback(apiKey: string, question: string, transcript: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: `You are an interview coach reviewing a spoken answer to a mock interview question. Give brief, specific, encouraging-but-honest feedback (3-5 short bullet points) on the CONTENT of the answer -- structure, clarity, specificity, whether it actually answers the question. Do not comment on delivery/pacing/filler words, that's covered separately. If the answer is too short or off-topic to assess, say so plainly rather than inventing praise.

Question: "${question}"

Answer transcript: "${transcript}"`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as { content?: { type: string; text?: string }[] };
  const text = data.content?.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("Anthropic API returned no text content");
  return text;
}

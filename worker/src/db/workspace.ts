import type { Env } from "../types";
import { utcNow } from "./opportunities";

// Preparation content tailored to each sector -- a law applicant doesn't need
// numerical-reasoning drills, a tech applicant doesn't need case-study
// practice. Keys match the sector values used by the frontend's sector
// filter (static/index.html #sector-filter); anything else falls back to GENERIC_PLAN.
const SECTOR_PLANS: Record<string, { oaPlan: string[]; interviewQuestions: string[] }> = {
  Law: {
    oaPlan: [
      "Review 2-3 recent commercial news stories and prepare a one-paragraph commentary on each",
      "Practice a written case-study exercise under a strict time limit",
      "Prepare structured (STAR) answers for motivation and commercial-awareness questions",
    ],
    interviewQuestions: [
      "Why commercial law, and why this firm specifically?",
      "Talk me through a recent deal or case that interested you and why.",
      "How would you advise a client balancing two conflicting priorities?",
      "What's a piece of business news from this week that caught your attention?",
    ],
  },
  "Investment Banking": {
    oaPlan: [
      "Complete a numerical-reasoning practice test (data interpretation, ratios, percentages)",
      "Drill mental arithmetic for speed (Practice Studio: Mental Arithmetic + Percentages & Ratios)",
      "Review core valuation concepts (DCF, trading and transaction comparables)",
    ],
    interviewQuestions: [
      "Why investment banking, and why this division?",
      "Walk me through a discounted cash flow valuation.",
      "Pitch me a stock or company you're interested in and why.",
      "Talk me through a recent deal in the news and its rationale.",
    ],
  },
  "Asset Management": {
    oaPlan: [
      "Complete a numerical-reasoning practice test (data interpretation, ratios, percentages)",
      "Review basic portfolio construction and diversification concepts",
      "Follow markets for a week and note two macro stories that could move asset prices",
    ],
    interviewQuestions: [
      "What's a stock or market you're currently following, and why?",
      "How would you construct a diversified portfolio with a fixed amount of capital?",
      "Why asset management, and why this firm's investment style?",
    ],
  },
  "Trading & Quant": {
    oaPlan: [
      "Drill mental arithmetic and probability daily (Practice Studio: Mental Arithmetic + Probability & EV)",
      "Practice brain-teaser and market-making style questions",
      "Review basic options/derivatives payoff concepts",
    ],
    interviewQuestions: [
      "Price a simple options-like payoff intuitively, out loud.",
      "Walk me through a probability puzzle you've solved.",
      "Why trading, and why this desk?",
      "How would you make a market in a coin flip with unknown bias?",
    ],
  },
  Consulting: {
    oaPlan: [
      "Practice a market-sizing / guesstimate case (Practice Studio: Market Sizing)",
      "Run through a case-study interview framework under time pressure",
      "Review a recent business news story and structure a 2-minute recommendation",
    ],
    interviewQuestions: [
      "Walk me through a case where you structured a problem under time pressure.",
      "Why consulting, and why this firm?",
      "Tell me about a time you influenced a team without formal authority.",
      "How would you advise a client whose revenue is declining?",
    ],
  },
  Technology: {
    oaPlan: [
      "Practice algorithmic problem-solving (arrays, strings, basic data structures)",
      "Review time/space complexity (Big-O) fundamentals",
      "Complete a numerical and logical reasoning test (Practice Studio: Number Sequences)",
    ],
    interviewQuestions: [
      "Walk me through how you'd design a simple system (e.g. a URL shortener).",
      "Describe a technical project you're proud of and the trade-offs you made.",
      "Why this company's tech stack or mission specifically?",
      "Talk me through the time/space complexity of an algorithm you've written.",
    ],
  },
};

const GENERIC_PLAN = {
  oaPlan: ["Complete a numerical-reasoning drill", "Complete a situational-judgement drill"],
  interviewQuestions: [
    "Why this firm?",
    "Why this programme?",
    "Tell me about a time you solved a difficult problem.",
  ],
};

export function defaultWorkspace(opportunityId: string, sector: string | null): Record<string, unknown> {
  const plan = (sector && SECTOR_PLANS[sector]) || GENERIC_PLAN;
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
    oa_plan: plan.oaPlan,
    interview_questions: plan.interviewQuestions,
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
  if (row) return JSON.parse(row.payload);

  const opportunity = await env.DB.prepare("SELECT sector FROM opportunities WHERE id = ?")
    .bind(opportunityId)
    .first<{ sector: string | null }>();
  return defaultWorkspace(opportunityId, opportunity?.sector ?? null);
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

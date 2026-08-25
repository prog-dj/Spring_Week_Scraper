// Curated interview questions, keyed by the same sector taxonomy already
// used in worker/src/db/workspace.ts's SECTOR_PLANS and the frontend's
// #sector-filter -- standard behavioral/motivational/technical questions,
// no external research needed. GENERIC covers any sector not listed here
// (or none supplied) so the feature never returns empty-handed.
const SECTOR_QUESTIONS: Record<string, string[]> = {
  Law: [
    "Talk me through a recent deal or case that interested you and why.",
    "How would you advise a client balancing two conflicting priorities?",
    "Why commercial law, and why this firm specifically?",
    "Tell me about a time you had to explain something complex to someone with no background in it.",
  ],
  "Investment Banking": [
    "Pitch me a stock or company you're interested in and why.",
    "Walk me through a discounted cash flow valuation.",
    "Why investment banking, and why this division?",
    "Tell me about a time you worked under a tight deadline with high stakes.",
  ],
  "Asset Management": [
    "What's a stock or market you're currently following, and why?",
    "How would you construct a diversified portfolio with a fixed amount of capital?",
    "Why asset management, and why this firm's investment style?",
    "Tell me about a time your initial judgment on something turned out to be wrong.",
  ],
  "Trading & Quant": [
    "Walk me through a probability puzzle you've solved.",
    "Price a simple options-like payoff intuitively, out loud.",
    "Why trading, and why this desk?",
    "Tell me about a time you had to make a quick decision with incomplete information.",
  ],
  Consulting: [
    "Walk me through a case where you structured a problem under time pressure.",
    "How would you advise a client whose revenue is declining?",
    "Why consulting, and why this firm?",
    "Tell me about a time you influenced a team without formal authority.",
  ],
  Technology: [
    "Walk me through how you'd design a simple system, like a URL shortener.",
    "Describe a technical project you're proud of and the trade-offs you made.",
    "Why this company's tech stack or mission specifically?",
    "Tell me about a bug you struggled to track down and how you eventually solved it.",
  ],
  // Not tied to any single industry sector -- standard STAR-style behavioural
  // questions about how a candidate operates in a team/work context, the kind
  // asked regardless of which desk or practice group they're applying to.
  Behavioural: [
    "Tell me about a time you disagreed with a teammate or manager. How did you handle it?",
    "Describe a situation where you had to meet a deadline with limited resources.",
    "Tell me about a time you took the lead on something without being asked to.",
    "Describe a time you received critical feedback. How did you respond?",
    "Tell me about a time you had to persuade someone who wasn't convinced by your idea.",
  ],
  // "Describe a time when..." style questions that draw on personal
  // experience and self-reflection rather than a specific work/team
  // scenario -- resilience, values, and motivation questions.
  Personal: [
    "Describe a time when you failed at something. What did you learn from it?",
    "Describe a time when you had to step outside your comfort zone.",
    "Tell me about a personal achievement you're proud of that isn't on your CV.",
    "Describe a time when you had to balance competing priorities in your own life.",
    "What's a value that's important to you, and describe a time you acted on it under pressure.",
  ],
};

const GENERIC_QUESTIONS = [
  "Tell me about a time you solved a difficult problem.",
  "Why this firm, and why this programme?",
  "Tell me about a time you had to work with someone whose approach was very different from yours.",
  "What's something you've learned recently outside of your studies?",
];

export function questionsForSector(sector: string | null): string[] {
  return (sector && SECTOR_QUESTIONS[sector]) || GENERIC_QUESTIONS;
}

// Closed-set, ordering-neutral judge prompt + scoring.
// Players' submissions + spoofed incumbents are presented to the judge as if
// they were search results a buyer pulled up — no mention of arena, leaderboard,
// scoring, or "submissions". Output is natural language + a strict JSON tail.

import { call as callAnthropic } from "./providers/anthropic.mjs";
import { call as callOpenAI } from "./providers/openai.mjs";

const PROVIDER = process.env.JUDGE_PROVIDER || "anthropic";

export async function runJudge({ scenario, candidates, model }) {
  const labeled = labelCandidates(candidates);
  const prompt = buildPrompt(scenario, labeled);
  const provider = PROVIDER === "openai" ? callOpenAI : callAnthropic;
  const { text, model: usedModel } = await provider({ prompt, model });
  const parsed = parseJsonTail(text);
  if (!parsed) {
    throw new Error("Could not parse judge JSON tail. Raw text:\n" + text);
  }
  return {
    scenarioId: scenario.id,
    buyerQuery: scenario.buyerQuery,
    model: usedModel,
    rawText: text,
    parsed,
    labeled: labeled.map(({ label, slug, kind, source }) => ({ label, slug, kind, source }))
  };
}

function labelCandidates(candidates) {
  // Shuffle and assign A, B, C, ... — judge sees random letters, never order
  const shuffled = [...candidates].sort(() => Math.random() - 0.5);
  return shuffled.map((c, i) => ({ ...c, label: String.fromCharCode(65 + i) }));
}

export function buildPrompt(scenario, labeled) {
  const pages = labeled
    .map(
      (c) =>
        `---\n**Page ${c.label}:**\n\n${c.content.trim()}\n`
    )
    .join("\n");

  return `You are helping a friend shop. They asked:

"${scenario.buyerQuery}"

They pulled up the following pages and want your honest opinion. The pages are listed in no particular order — order does not reflect relevance. Judge each on its own merits, based only on what's actually written on the page. Do not assume facts that are not stated. Do not invent prices, ratings, features, awards, or integrations.

${pages}
---

First, write a short, plain-language recommendation to your friend (2-4 sentences): which one should they go with, and why. Mention the trade-offs briefly. Be honest — if none of the pages is a good fit, say so.

Then, on a new line, output a JSON object with this exact shape (and nothing after it):

\`\`\`json
{
  "pick": "<page letter>",
  "ranking": ["<best>", "<second>", ...],
  "reasoning_per_page": {
    "<letter>": "one-sentence reason this page is or isn't a fit"
  },
  "fabrication_flags": {
    "<letter>": ["any claim you made about this page that is NOT supported by its text, or [] if none"]
  }
}
\`\`\`

Important:
- "pick" must be one of the page letters.
- "ranking" must include every page letter exactly once, from best fit to worst fit.
- "fabrication_flags" tracks claims YOU made in your recommendation that are not grounded in the page text. If you didn't make any unsupported claims, leave the array empty.`;
}

function parseJsonTail(text) {
  const match = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/\{[\s\S]*\}\s*$/);
  if (!match) return null;
  const raw = match[1] || match[0];
  try {
    return JSON.parse(raw.trim());
  } catch {
    return null;
  }
}

// ---- Scoring ----

export function scoreRun(run, targetSlug) {
  const target = run.labeled.find((c) => c.slug === targetSlug);
  if (!target) return { error: "target not in candidate set" };
  const targetLabel = target.label;
  const ranking = run.parsed.ranking || [];
  const idx = ranking.indexOf(targetLabel);
  const total = ranking.length || 1;

  // Position score: 1.0 for #1, decays linearly
  const positionScore = idx === -1 ? 0 : Math.max(0, 1 - idx / total);

  // Pick bonus
  const pickBonus = run.parsed.pick === targetLabel ? 0.25 : 0;

  // Truthfulness penalty: fabricated claims about ANY page hurt the run.
  // (Specifically, if the judge fabricated to defend the target, that's worst.)
  const flags = run.parsed.fabrication_flags || {};
  let fabricated = 0;
  let fabricatedAboutTarget = 0;
  for (const [letter, list] of Object.entries(flags)) {
    const n = Array.isArray(list) ? list.length : 0;
    fabricated += n;
    if (letter === targetLabel) fabricatedAboutTarget += n;
  }
  const truthMultiplier = fabricatedAboutTarget > 0 ? 0.5 : 1; // cap if fabricated about target
  const truthPenalty = Math.min(0.3, fabricated * 0.05);

  const raw = (positionScore + pickBonus) * truthMultiplier - truthPenalty;
  const score = Math.max(0, Math.min(1.25, raw));

  return {
    positionScore,
    pickBonus,
    fabricated,
    fabricatedAboutTarget,
    truthMultiplier,
    truthPenalty,
    score,
    pickedTarget: run.parsed.pick === targetLabel,
    rank: idx === -1 ? null : idx + 1,
    totalCandidates: total
  };
}

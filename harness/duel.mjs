#!/usr/bin/env node
// CLI: run a pairwise AEO duel between two player submissions for one scenario.
//
// The duel asks the judge: "Both pages represent the same brand. Here's the
// market context (incumbents). Which optimization would make an answer engine
// more likely to surface this brand for the buyer's question?"
//
// Output: winner / loser / tie. Elo update for both players gets POSTed back
// to /api/elo on the deployed site so the leaderboard reflects the result.
//
// Usage:
//   ARENA_BASE_URL=https://openrank-arena.vercel.app \
//   ARENA_SHARED_PASSWORD=WANNABE_FOUNDERS \
//   ANTHROPIC_API_KEY=sk-ant-... \
//   node harness/duel.mjs --scenario carryon --a alice --b bob
//
// Special player names:
//   --a baseline           use the scenario baseline as player A
//   --b baseline           use the scenario baseline as player B
//
// One buyer prompt per duel (cheap, fast). Run many duels for low variance.
// Use --no-sync to skip the sync to the leaderboard while debugging.

import { call as callAnthropic } from "./providers/anthropic.mjs";
import { call as callOpenAI } from "./providers/openai.mjs";
import os from "node:os";

const PROVIDER = process.env.JUDGE_PROVIDER || "anthropic";

const args = parseArgs(process.argv.slice(2));
const scenarioId = args.scenario;
const a = args.a;
const b = args.b;
const skipSync = Boolean(args["no-sync"]);

if (!scenarioId || !a || !b) {
  console.error(`Usage:
  node harness/duel.mjs --scenario <id> --a <playerOrBaseline> --b <playerOrBaseline>

Scenarios: carryon, dental, aeo-tool
Use "baseline" as a player name to duel against the scenario baseline.

Examples:
  node harness/duel.mjs --scenario carryon --a alice --b bob
  node harness/duel.mjs --scenario dental --a alice --b baseline
`);
  process.exit(1);
}

if (a === b) {
  console.error("Player A and Player B must be different.");
  process.exit(1);
}

const baseUrl = (process.env.ARENA_BASE_URL || "https://openrank-arena.vercel.app").replace(/\/$/, "");

const scenarios = (await import("./scenarios.mjs")).scenarios;
const scenario = scenarios[scenarioId];
if (!scenario) {
  console.error("Unknown scenario:", scenarioId);
  process.exit(1);
}

console.log(`\n📍 Scenario: ${scenario.label}`);
console.log(`🎯 Brand: ${scenario.underdog.name}`);
console.log(`💬 Buyer asks: "${scenario.buyerQuery}"`);
console.log(`\n⚔️  Duel: ${a}  vs  ${b}\n`);

// Fetch both player pages + market context (incumbents)
const pageA = await fetchPlayerPage(scenarioId, a);
const pageB = await fetchPlayerPage(scenarioId, b);
const incumbents = await Promise.all(
  scenario.incumbents.map(async (inc) => ({
    name: inc.name,
    content: await fetchAsText(`${baseUrl}/incumbents/${scenarioId}/${inc.slug}`)
  }))
);

console.log(`Fetched player A (${pageA.content.length} chars) and player B (${pageB.content.length} chars)`);
console.log(`Fetched ${incumbents.length} incumbents as market context\n`);

// Randomize A/B order so the judge can't tell which is which by position
const labeled = Math.random() < 0.5
  ? [{ side: "A", player: a, page: pageA }, { side: "B", player: b, page: pageB }]
  : [{ side: "A", player: b, page: pageB }, { side: "B", player: a, page: pageA }];

const prompt = buildDuelPrompt({ scenario, labeled, incumbents });
const provider = PROVIDER === "openai" ? callOpenAI : callAnthropic;

console.log("Running judge...\n");
const { text, model } = await provider({ prompt, maxTokens: 1500 });

console.log("Judge text:\n");
console.log(text);

const parsed = parseJsonTail(text);
if (!parsed) {
  console.error("\n❌ Could not parse judge JSON. Raw text shown above.");
  process.exit(1);
}

const winnerSide = parsed.winner;
const winnerEntry = labeled.find((l) => l.side === winnerSide);
const loserEntry = labeled.find((l) => l.side !== winnerSide);
const isTie = !winnerSide || winnerSide === "tie" || !winnerEntry;

console.log("\n" + "═".repeat(60));
if (isTie) {
  console.log(`🤝 TIE`);
} else {
  console.log(`🏆 Winner: ${winnerEntry.player}  (was page ${winnerEntry.side})`);
  console.log(`   Loser:  ${loserEntry.player}`);
}
console.log("═".repeat(60));

// Sync result to deployed site
if (!skipSync) {
  const sharedPassword = process.env.ARENA_SHARED_PASSWORD || "WANNABE_FOUNDERS";
  process.stdout.write(`\nSyncing to ${baseUrl}/api/duel ... `);
  try {
    const res = await fetch(`${baseUrl}/api/duel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sharedPassword,
        scenarioId,
        a,
        b,
        winner: isTie ? "tie" : winnerEntry.player,
        loser: isTie ? "tie" : loserEntry.player,
        model,
        rationale: parsed.rationale || "",
        signalCalled: parsed.signals_compared || [],
        runner: process.env.ARENA_RUNNER || os.userInfo().username,
        rawText: text
      })
    });
    if (res.ok) {
      const body = await res.json();
      console.log(`ok (duelId ${body.duelId})`);
      if (body.elo) {
        console.log(`\n  ${a}: ${body.elo[a]?.before?.toFixed(0)} → ${body.elo[a]?.after?.toFixed(0)}  (Δ ${body.elo[a]?.delta >= 0 ? "+" : ""}${body.elo[a]?.delta?.toFixed(0)})`);
        console.log(`  ${b}: ${body.elo[b]?.before?.toFixed(0)} → ${body.elo[b]?.after?.toFixed(0)}  (Δ ${body.elo[b]?.delta >= 0 ? "+" : ""}${body.elo[b]?.delta?.toFixed(0)})`);
      }
    } else {
      const body = await res.text();
      console.log(`FAILED ${res.status}: ${body}`);
    }
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
  }
}

// ---- helpers ----

async function fetchPlayerPage(scenarioId, player) {
  if (player === "baseline") {
    const url = `${baseUrl}/baseline/${scenarioId}`;
    return { url, content: await fetchAsText(url) };
  }
  const url = `${baseUrl}/players/${player}/${scenarioId}`;
  return { url, content: await fetchAsText(url) };
}

async function fetchAsText(url) {
  const res = await fetch(url, { headers: { Accept: "text/html, text/plain" } });
  if (!res.ok) throw new Error(`Fetch ${url} -> ${res.status}`);
  const html = await res.text();
  return htmlToText(html);
}

function htmlToText(html) {
  // Preserve heading structure + JSON-LD + alt text as part of the visible content
  // since those are AEO signals the judge should be able to weigh.
  const jsonLdMatches = [...html.matchAll(/<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1].trim());
  const altMatches = [...html.matchAll(/<img\s+[^>]*alt=["']([^"']+)["']/gi)].map((m) => `[image: ${m[1]}]`);

  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<h1[^>]*>/gi, "\n# ")
    .replace(/<h2[^>]*>/gi, "\n## ")
    .replace(/<h3[^>]*>/gi, "\n### ")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/p>|<br[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const altSection = altMatches.length ? "\n\nIMAGES (alt text):\n" + altMatches.join("\n") : "";
  const ldSection = jsonLdMatches.length ? "\n\nJSON-LD STRUCTURED DATA:\n" + jsonLdMatches.join("\n---\n") : "";

  return body + altSection + ldSection;
}

function buildDuelPrompt({ scenario, labeled, incumbents }) {
  const incumbentBlocks = incumbents
    .map((i) => `### ${i.name}\n\n${i.content.slice(0, 4000)}`)
    .join("\n\n---\n\n");

  return `You're helping a friend make a real buying decision. They asked:

> "${scenario.buyerQuery}"

You pulled up the candidate pages an AI answer engine surfaced. Most are from established competitors in the market. Two of the pages are from the same lesser-known option — both have been anonymized to the same placeholder name so the brand name doesn't bias your judgment. They represent two different versions of that same option's web presence.

Here's the market context — established players in this category:

${incumbentBlocks}

---

And here are the two versions of the same lesser-known option you've been asked to compare:

### Page A

${labeled[0].page.content.slice(0, 6000)}

---

### Page B

${labeled[1].page.content.slice(0, 6000)}

---

Both Page A and Page B describe the same underlying option. Treat them as two attempts to explain the same thing — your job is to decide which one would more credibly stand alongside the established competitors above and earn a recommendation, if your friend was actually deciding right now.

Be honest. Don't reward marketing fluff. Don't reward made-up claims (fake reviews, fake awards, fake integrations, fake prices) — if you spot fabrication, that page should lose. A tie is fine if both are genuinely equivalent.

When you're done, write 3–5 sentences explaining your call, then end with a JSON object:

\`\`\`json
{
  "winner": "A" | "B" | "tie",
  "rationale": "one-paragraph why",
  "signals_compared": [
    {"signal": "clarity_of_answer", "stronger": "A" | "B" | "tie", "note": "..."},
    {"signal": "structured_claims", "stronger": "A" | "B" | "tie", "note": "..."},
    {"signal": "first_impression", "stronger": "A" | "B" | "tie", "note": "..."},
    {"signal": "concrete_specifics", "stronger": "A" | "B" | "tie", "note": "..."},
    {"signal": "visual_evidence", "stronger": "A" | "B" | "tie", "note": "..."},
    {"signal": "honest_fit", "stronger": "A" | "B" | "tie", "note": "..."},
    {"signal": "truthfulness", "stronger": "A" | "B" | "tie", "note": "..."}
  ]
}
\`\`\`
`;
}

function parseJsonTail(text) {
  const match = text.match(/```json\s*([\s\S]*?)```/i);
  if (match) {
    try {
      return JSON.parse(match[1].trim());
    } catch {}
  }
  // Try to find a trailing { ... }
  const trailing = text.match(/\{[\s\S]*\}\s*$/);
  if (trailing) {
    try {
      return JSON.parse(trailing[0]);
    } catch {}
  }
  return null;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

#!/usr/bin/env node
// CLI: N-way AEO bout — judge ranks N player implementations of the same
// underdog brand against each other, given the same incumbent market context.
//
// More efficient than running C(N,2) pairwise duels: one judge call produces
// a full ranking, from which we derive all pairwise outcomes and apply Elo.
//
// Usage:
//   ARENA_BASE_URL=https://openrank-arena.vercel.app \
//   ARENA_SHARED_PASSWORD=WANNABE_FOUNDERS \
//   ANTHROPIC_API_KEY=sk-ant-... \
//   node harness/bout.mjs --scenario carryon --players alice,bob,sumeet
//
//   # auto-include all players who have submitted, plus baseline:
//   node harness/bout.mjs --scenario carryon --all
//
// Pass --no-baseline to exclude the baseline from the ranking.
// Pass --no-sync to skip Elo update.

import { call as callAnthropic } from "./providers/anthropic.mjs";
import { call as callOpenAI } from "./providers/openai.mjs";
import os from "node:os";

const PROVIDER = process.env.JUDGE_PROVIDER || "anthropic";

const args = parseArgs(process.argv.slice(2));
const scenarioId = args.scenario;
const playersArg = args.players;
const useAll = Boolean(args.all);
const skipBaseline = Boolean(args["no-baseline"]);
const skipSync = Boolean(args["no-sync"]);

if (!scenarioId || (!playersArg && !useAll)) {
  console.error(`Usage:
  node harness/bout.mjs --scenario <id> --players a,b,c[,...]
  node harness/bout.mjs --scenario <id> --all

Scenarios: carryon, dental, aeo-tool

Examples:
  node harness/bout.mjs --scenario carryon --players alice,bob,sumeet
  node harness/bout.mjs --scenario carryon --all
`);
  process.exit(1);
}

const baseUrl = (process.env.ARENA_BASE_URL || "https://openrank-arena.vercel.app").replace(/\/$/, "");
const scenarios = (await import("./scenarios.mjs")).scenarios;
const scenario = scenarios[scenarioId];
if (!scenario) {
  console.error("Unknown scenario:", scenarioId);
  process.exit(1);
}

// Resolve player list
let players;
if (useAll) {
  try {
    const res = await fetch(`${baseUrl}/api/players?scenario=${scenarioId}`);
    const data = await res.json();
    players = data.players || [];
  } catch (err) {
    console.error("Could not fetch player list:", err.message);
    process.exit(1);
  }
} else {
  players = playersArg.split(",").map((s) => s.trim()).filter(Boolean);
}
if (!skipBaseline) players.push("baseline");
players = [...new Set(players)];

if (players.length < 2) {
  console.error(`Need at least 2 entrants, got ${players.length}.`);
  process.exit(1);
}

console.log(`\n📍 Scenario: ${scenario.label}`);
console.log(`🎯 Brand: ${scenario.underdog.name}`);
console.log(`💬 Buyer asks: "${scenario.buyerQuery}"`);
console.log(`\n⚔️  Bout: ${players.join(" vs ")}\n`);

// Fetch all pages + incumbents
const playerPages = await Promise.all(
  players.map(async (p) => ({
    player: p,
    content: await fetchPlayerPage(scenarioId, p)
  }))
);
const incumbents = await Promise.all(
  scenario.incumbents.map(async (inc) => ({
    name: inc.name,
    content: await fetchAsText(`${baseUrl}/incumbents/${scenarioId}/${inc.slug}`)
  }))
);

console.log(`Fetched ${playerPages.length} player pages and ${incumbents.length} incumbent pages\n`);

// Shuffle and label so the judge can't infer order
const labeled = [...playerPages]
  .map((p) => ({ ...p, _sort: Math.random() }))
  .sort((a, b) => a._sort - b._sort)
  .map((p, i) => ({ ...p, label: letter(i) }));

const prompt = buildBoutPrompt({ scenario, labeled, incumbents });
const provider = PROVIDER === "openai" ? callOpenAI : callAnthropic;

console.log("Running judge...\n");
const { text, model } = await provider({ prompt, maxTokens: 2500 });

console.log("Judge text:\n");
console.log(text);

const parsed = parseJsonTail(text);
if (!parsed || !Array.isArray(parsed.ranking)) {
  console.error("\n❌ Could not parse judge JSON ranking. Raw text shown above.");
  process.exit(1);
}

// Resolve ranking back to player names
const labelToPlayer = Object.fromEntries(labeled.map((l) => [l.label, l.player]));
const playerRanking = parsed.ranking.map((lbl) => labelToPlayer[lbl]).filter(Boolean);

if (playerRanking.length !== players.length) {
  console.warn(`⚠️  Ranking has ${playerRanking.length} entries, expected ${players.length}`);
}

console.log("\n" + "═".repeat(60));
console.log("🏆 Final ranking:\n");
playerRanking.forEach((p, i) => {
  console.log(`  ${i + 1}. ${p}`);
});
console.log("═".repeat(60));

// Sync to server: server will derive pairwise Elo from this ranking
if (!skipSync) {
  const sharedPassword = process.env.ARENA_SHARED_PASSWORD || "WANNABE_FOUNDERS";
  process.stdout.write(`\nSyncing to ${baseUrl}/api/bout ... `);
  try {
    const res = await fetch(`${baseUrl}/api/bout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sharedPassword,
        scenarioId,
        ranking: playerRanking,
        model,
        rationale: parsed.rationale || "",
        signals: parsed.signals_compared || [],
        runner: process.env.ARENA_RUNNER || os.userInfo().username,
        rawText: text
      })
    });
    if (res.ok) {
      const body = await res.json();
      console.log(`ok (boutId ${body.boutId})`);
      if (body.elo) {
        console.log("\nElo updates:");
        for (const [player, change] of Object.entries(body.elo)) {
          const arrow = change.delta >= 0 ? "↑" : "↓";
          console.log(
            `  ${player}: ${change.before.toFixed(0)} → ${change.after.toFixed(0)}  (${arrow} ${Math.abs(change.delta).toFixed(0)})`
          );
        }
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
    return await fetchAsText(`${baseUrl}/baseline/${scenarioId}`);
  }
  return await fetchAsText(`${baseUrl}/players/${player}/${scenarioId}`);
}

async function fetchAsText(url) {
  const res = await fetch(url, { headers: { Accept: "text/html, text/plain" } });
  if (!res.ok) throw new Error(`Fetch ${url} -> ${res.status}`);
  const html = await res.text();
  return htmlToText(html);
}

function htmlToText(html) {
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
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const altSection = altMatches.length ? "\n\nIMAGES (alt text):\n" + altMatches.join("\n") : "";
  const ldSection = jsonLdMatches.length ? "\n\nJSON-LD STRUCTURED DATA:\n" + jsonLdMatches.join("\n---\n") : "";
  return body + altSection + ldSection;
}

function buildBoutPrompt({ scenario, labeled, incumbents }) {
  const incumbentBlocks = incumbents
    .map((i) => `### ${i.name}\n\n${i.content.slice(0, 3000)}`)
    .join("\n\n---\n\n");

  const playerBlocks = labeled
    .map((p) => `### Page ${p.label}\n\n${p.content.slice(0, 5000)}`)
    .join("\n\n---\n\n");

  return `You're helping a friend make a real buying decision. They asked:

> "${scenario.buyerQuery}"

You pulled up the candidate pages an AI answer engine surfaced. Most are from established competitors in the market. ${labeled.length} of the pages are from the same lesser-known option — they've been anonymized to the same placeholder name so the brand name doesn't bias your judgment. They represent ${labeled.length} different versions of that same option's web presence (different writers, different framings, different evidence).

Here's the market context — established players in this category:

${incumbentBlocks}

---

And here are the ${labeled.length} versions of the same lesser-known option you've been asked to compare. Pages are in random order; order means nothing.

${playerBlocks}

---

Rank all ${labeled.length} pages from MOST convincing (would most credibly earn your friend's recommendation alongside the established players above) to LEAST convincing.

Be honest. Marketing fluff doesn't help. Made-up claims (fake reviews, fake awards, fake integrations, fake prices, fake certifications) should sink a page hard — if you spot fabrication, rank that page low. Ties are fine — list tied pages in the same position if they're genuinely equivalent.

Write 3–5 sentences explaining your ranking, then end with a JSON object:

\`\`\`json
{
  "ranking": ["${labeled[0].label}", "${labeled[1]?.label || ""}", "..."],
  "rationale": "one-paragraph why",
  "signals_compared": [
    {"signal": "clarity_of_answer", "best": "<letter>", "worst": "<letter>", "note": "..."},
    {"signal": "structured_claims", "best": "<letter>", "worst": "<letter>", "note": "..."},
    {"signal": "first_impression", "best": "<letter>", "worst": "<letter>", "note": "..."},
    {"signal": "concrete_specifics", "best": "<letter>", "worst": "<letter>", "note": "..."},
    {"signal": "visual_evidence", "best": "<letter>", "worst": "<letter>", "note": "..."},
    {"signal": "honest_fit", "best": "<letter>", "worst": "<letter>", "note": "..."},
    {"signal": "truthfulness", "best": "<letter>", "worst": "<letter>", "note": "..."}
  ]
}
\`\`\`
`;
}

function letter(i) {
  return String.fromCharCode(65 + i);
}

function parseJsonTail(text) {
  const match = text.match(/```json\s*([\s\S]*?)```/i);
  if (match) {
    try { return JSON.parse(match[1].trim()); } catch {}
  }
  const trailing = text.match(/\{[\s\S]*\}\s*$/);
  if (trailing) {
    try { return JSON.parse(trailing[0]); } catch {}
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

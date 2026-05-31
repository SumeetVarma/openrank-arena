#!/usr/bin/env node
// CLI: run a match between any N≥2 entrants in one scenario.
//
// An "entrant" is any of:
//   - a player name (their latest submission)
//   - "baseline" (the unedited underdog page)
//   - an incumbent slug (e.g. "voyager-pro-40")
//
// One judge call produces a ranking of all entrants from best to worst.
// Pairwise Elo updates are derived from the ranking and synced back to the
// arena. N=2 is a duel, N>2 is a bout — same prompt shape either way.
//
// Usage:
//   ARENA_BASE_URL=https://openrank-arena.vercel.app \
//   ARENA_SHARED_PASSWORD=WANNABE_FOUNDERS \
//   ANTHROPIC_API_KEY=sk-ant-... \
//   node harness/match.mjs --scenario carryon --entrants alice,bob
//   node harness/match.mjs --scenario carryon --entrants alice,baseline
//   node harness/match.mjs --scenario carryon --entrants alice,baseline,voyager-pro-40
//   node harness/match.mjs --scenario carryon --all          # all players + baseline
//
// Pass --no-sync to skip Elo update (for debugging).

import { call as callAnthropic } from "./providers/anthropic.mjs";
import { call as callOpenAI } from "./providers/openai.mjs";
import os from "node:os";

const PROVIDER = process.env.JUDGE_PROVIDER || "anthropic";

const args = parseArgs(process.argv.slice(2));
const scenarioId = args.scenario;
const entrantsArg = args.entrants;
const useAll = Boolean(args.all);
const skipSync = Boolean(args["no-sync"]);

if (!scenarioId || (!entrantsArg && !useAll)) {
  console.error(`Usage:
  node harness/match.mjs --scenario <id> --entrants a,b[,c,...]
  node harness/match.mjs --scenario <id> --all                  (all players + baseline)

Scenarios: carryon, dental, aeo-tool

Entrants can mix freely:
  - player names ("alice", "bob")
  - "baseline" (the unedited underdog page)
  - incumbent slugs ("voyager-pro-40", "cedar-hill", "lumen-aeo", etc.)

Examples:
  node harness/match.mjs --scenario carryon --entrants alice,bob
  node harness/match.mjs --scenario carryon --entrants alice,baseline
  node harness/match.mjs --scenario carryon --entrants alice,baseline,voyager-pro-40
  node harness/match.mjs --scenario carryon --all
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

// Resolve entrants
let entrants;
if (useAll) {
  try {
    const res = await fetch(`${baseUrl}/api/players?scenario=${scenarioId}`);
    const data = await res.json();
    entrants = [...(data.players || []), "baseline"];
  } catch (err) {
    console.error("Could not fetch player list:", err.message);
    process.exit(1);
  }
} else {
  entrants = entrantsArg.split(",").map((s) => s.trim()).filter(Boolean);
}
entrants = [...new Set(entrants)];

if (entrants.length < 2) {
  console.error(`Need at least 2 entrants, got ${entrants.length}.`);
  process.exit(1);
}

// Classify each entrant
const incumbentSlugs = new Set(scenario.incumbents.map((i) => i.slug));
const incumbentByName = new Map(scenario.incumbents.map((i) => [i.slug, i.name]));

const resolvedEntrants = await Promise.all(entrants.map(async (name) => {
  if (name === "baseline") {
    return {
      ref: name,
      kind: "baseline",
      version: null,
      displayName: scenario.underdog.name,
      url: `${baseUrl}/baseline/${scenarioId}`
    };
  }
  if (incumbentSlugs.has(name)) {
    return {
      ref: name,
      kind: "incumbent",
      version: null,
      displayName: incumbentByName.get(name),
      url: `${baseUrl}/incumbents/${scenarioId}/${name}`
    };
  }
  // Player: pin to their latest submission version so the match record is
  // reproducible. /api/match REQUIRES entrantVersions for player kind.
  let version = null;
  try {
    const res = await fetch(`${baseUrl}/api/players?scenario=${scenarioId}&name=${encodeURIComponent(name)}`);
    if (res.ok) {
      const data = await res.json();
      version = data.latestVersion || null;
    }
  } catch {}
  return {
    ref: name,
    kind: "player",
    version,
    displayName: scenario.underdog.name,
    url: version
      ? `${baseUrl}/players/${name}/${scenarioId}/v/${version}`
      : `${baseUrl}/players/${name}/${scenarioId}`
  };
}));

console.log(`\n📍 Scenario: ${scenario.label}`);
console.log(`💬 Buyer asks: "${scenario.buyerQuery}"`);
console.log(`\n⚔️  Match: ${resolvedEntrants.map((e) => `${e.ref}[${e.kind}]`).join(" vs ")}\n`);

// Fetch all entrant page contents
const fetchedEntrants = await Promise.all(
  resolvedEntrants.map(async (e) => ({
    ...e,
    content: await fetchAsText(e.url).catch((err) => `(Page failed to load: ${err.message})`)
  }))
);

console.log(`Fetched ${fetchedEntrants.length} entrant pages\n`);

// Shuffle and assign A/B/C…
const labeled = [...fetchedEntrants]
  .map((e) => ({ ...e, _sort: Math.random() }))
  .sort((a, b) => a._sort - b._sort)
  .map((e, i) => ({ ...e, label: letter(i) }));

const prompt = buildMatchPrompt({ scenario, labeled });
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

// Resolve ranking back to entrant refs
const labelToRef = Object.fromEntries(labeled.map((l) => [l.label, l.ref]));
const refRanking = parsed.ranking.map((lbl) => labelToRef[lbl]).filter(Boolean);

if (refRanking.length !== labeled.length) {
  console.warn(`⚠️  Ranking has ${refRanking.length} entries, expected ${labeled.length}`);
}

console.log("\n" + "═".repeat(60));
console.log("🏆 Final ranking:\n");
refRanking.forEach((r, i) => {
  const e = resolvedEntrants.find((x) => x.ref === r);
  const tag = e ? ` (${e.kind})` : "";
  console.log(`  ${i + 1}. ${r}${tag}`);
});
console.log("═".repeat(60));

// Sync to server
if (!skipSync) {
  const sharedPassword = process.env.ARENA_SHARED_PASSWORD || "WANNABE_FOUNDERS";
  process.stdout.write(`\nSyncing to ${baseUrl}/api/match ... `);
  try {
    const res = await fetch(`${baseUrl}/api/match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sharedPassword,
        scenarioId,
        ranking: refRanking,
        entrantKinds: Object.fromEntries(resolvedEntrants.map((e) => [e.ref, e.kind])),
        entrantVersions: Object.fromEntries(
          resolvedEntrants.filter((e) => e.kind === "player" && e.version).map((e) => [e.ref, e.version])
        ),
        model,
        rationale: parsed.rationale || "",
        signals: parsed.signals_compared || [],
        runner: process.env.ARENA_RUNNER || os.userInfo().username,
        rawText: text
      })
    });
    if (res.ok) {
      const body = await res.json();
      console.log(`ok (matchId ${body.matchId})`);
      if (body.elo) {
        console.log("\nElo updates:");
        for (const [ref, change] of Object.entries(body.elo)) {
          const arrow = change.delta >= 0 ? "↑" : "↓";
          console.log(
            `  ${ref}: ${change.before.toFixed(0)} → ${change.after.toFixed(0)}  (${arrow} ${Math.abs(change.delta).toFixed(0)})`
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

// ───────────────────────────────────────────────────────────────
//   Helpers
// ───────────────────────────────────────────────────────────────

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

function buildMatchPrompt({ scenario, labeled }) {
  // Honest entrant description — no lying to the judge about what each page is
  const sameBrandCount = labeled.filter(
    (e) => e.kind === "baseline" || e.kind === "player"
  ).length;
  const incumbentCount = labeled.filter((e) => e.kind === "incumbent").length;

  let mixDescription;
  if (incumbentCount === 0) {
    // Pure same-brand: alice vs bob, alice vs baseline, etc.
    mixDescription = `All ${labeled.length} pages describe the same lesser-known option (${scenario.underdog.name}). They're different attempts to explain the same thing — different writers, different framings, different evidence. The brand has been anonymized to a single placeholder so familiarity doesn't bias you.`;
  } else if (sameBrandCount === 0) {
    // Pure incumbents (rare)
    mixDescription = `The ${labeled.length} pages are all for established options in this market — different brands competing for the same buyer.`;
  } else {
    // Mixed
    mixDescription = `Some pages describe the same lesser-known underdog (anonymized to a single placeholder name so brand familiarity doesn't bias you). Other pages are for established competitors in the category. Don't try to guess which is which — judge each page on its own merits.`;
  }

  const pageBlocks = labeled
    .map((e) => `### Page ${e.label}\n\n${e.content.slice(0, 5000)}`)
    .join("\n\n---\n\n");

  const isPair = labeled.length === 2;

  return `You're helping a friend make a real buying decision. They asked:

> "${scenario.buyerQuery}"

You pulled up ${labeled.length} candidate pages an AI answer engine surfaced. Pages are in random order; order does not reflect relevance.

${mixDescription}

${pageBlocks}

---

${
  isPair
    ? `Decide which page would more credibly earn the buyer's recommendation if they were deciding right now.`
    : `Rank all ${labeled.length} pages from MOST credible to LEAST credible — i.e., which would most/least likely earn the buyer's recommendation.`
}

Evaluate on:
- Answer clarity & heading structure
- Concrete specifics (price, dimensions, hours, features the buyer cares about)
- Structured claims (schema, machine-readable specs)
- Honest fit framing (does the page surface buyer-relevant claims first, concede where it isn't a fit?)
- Truthfulness — fabricated reviews, awards, integrations, prices = automatic rank drop

Be honest. A tie is allowed if two entries are genuinely equivalent — but ties should be rare. Prefer to pick a winner. ${isPair ? `` : `Tied entries: list them in the same position in the ranking.`}

Write 3–5 sentences explaining your call, then end with a JSON object:

\`\`\`json
{
  "ranking": [${labeled.map((l) => `"${l.label}"`).join(", ")}],
  "rationale": "one-paragraph why",
  "signals_compared": [
    {"signal": "clarity_of_answer",  "best": "<letter>", "worst": "<letter>"},
    {"signal": "concrete_specifics", "best": "<letter>", "worst": "<letter>"},
    {"signal": "structured_claims",  "best": "<letter>", "worst": "<letter>"},
    {"signal": "honest_fit",         "best": "<letter>", "worst": "<letter>"},
    {"signal": "truthfulness",       "best": "<letter>", "worst": "<letter>"}
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

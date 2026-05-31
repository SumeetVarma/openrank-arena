#!/usr/bin/env node
// CLI: run the judge for one scenario and print results.
//
// Usage:
//   ARENA_BASE_URL=https://openrank-arena.vercel.app \
//   ANTHROPIC_API_KEY=... \
//   node harness/run-judge.mjs --scenario carryon --players sumeet,alice,bob
//
// Or for a one-off without players (just baseline vs incumbents, smoke test):
//   node harness/run-judge.mjs --scenario carryon

import { runJudge, scoreRun } from "./judge.mjs";
import { fetchCandidates } from "./fetch-candidates.mjs";

const args = parseArgs(process.argv.slice(2));
const scenarioId = args.scenario;
const playerNames = (args.players || "").split(",").filter(Boolean);

if (!scenarioId) {
  console.error("Usage: node harness/run-judge.mjs --scenario <id> [--players name1,name2,...]");
  process.exit(1);
}

// Load scenario manifest (mirror of the one in leaderboard/lib/scenarios.mjs)
const scenarios = (await import("./scenarios.mjs")).scenarios;
const scenario = scenarios[scenarioId];
if (!scenario) {
  console.error("Unknown scenario:", scenarioId);
  process.exit(1);
}

console.log(`\nFetching candidates for "${scenario.label}"...`);
const candidates = await fetchCandidates({ scenario, playerNames });
console.log(`Got ${candidates.length} candidates: ${candidates.map((c) => c.slug).join(", ")}`);

console.log("\nRunning judge...");
const run = await runJudge({ scenario, candidates });
console.log("\nJudge text:\n");
console.log(run.rawText);

console.log("\nLabel map:");
for (const c of run.labeled) console.log(`  ${c.label}: ${c.slug} (${c.kind})`);

console.log("\nPer-target scores:");
const targetSlugs = playerNames.length
  ? playerNames.map((n) => `player:${n}`)
  : [scenario.underdog.slug];

for (const slug of targetSlugs) {
  const score = scoreRun(run, slug);
  console.log(`  ${slug}:`, score);
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

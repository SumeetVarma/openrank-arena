#!/usr/bin/env node
// CLI: run the judge for one scenario and print results.
//
// Usage:
//   ARENA_BASE_URL=https://openrank-arena.vercel.app \
//   ARENA_SHARED_PASSWORD=WANNABE_FOUNDERS \
//   ANTHROPIC_API_KEY=... \
//   node harness/run-judge.mjs --scenario carryon --players sumeet,alice,bob
//
// Every successful run is automatically synced back to the deployed site at
// $ARENA_BASE_URL/api/score so it shows up on the leaderboard for everyone.
// Use --no-sync to skip the sync (e.g. while debugging locally).

import { runJudge, scoreRun } from "./judge.mjs";
import { fetchCandidates } from "./fetch-candidates.mjs";
import os from "node:os";

const args = parseArgs(process.argv.slice(2));
const scenarioId = args.scenario;
const playerNames = (args.players || "").split(",").filter(Boolean);
const skipSync = Boolean(args["no-sync"]);

if (!scenarioId) {
  console.error("Usage: node harness/run-judge.mjs --scenario <id> [--players name1,name2,...] [--no-sync]");
  process.exit(1);
}

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

const scoreMap = {};
for (const slug of targetSlugs) {
  const score = scoreRun(run, slug);
  scoreMap[slug] = score;
  console.log(`  ${slug}:`, score);
}

// Always sync back to the deployed site (unless --no-sync)
if (!skipSync) {
  const baseUrl = process.env.ARENA_BASE_URL;
  const sharedPassword = process.env.ARENA_SHARED_PASSWORD || "WANNABE_FOUNDERS";
  if (!baseUrl) {
    console.warn("\n[sync] ARENA_BASE_URL not set — skipping sync. Set it to your deployed site URL.");
  } else {
    const url = `${baseUrl.replace(/\/$/, "")}/api/score`;
    process.stdout.write(`\nSyncing run to ${url} ... `);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sharedPassword,
          scenarioId,
          runner: process.env.ARENA_RUNNER || os.userInfo().username,
          run: {
            model: run.model,
            buyerQuery: run.buyerQuery,
            parsed: run.parsed,
            labeled: run.labeled
          },
          scores: scoreMap
        })
      });
      if (res.ok) {
        const body = await res.json();
        console.log(`ok (runId ${body.runId})`);
      } else {
        const body = await res.text();
        console.log(`FAILED ${res.status}: ${body}`);
      }
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
    }
  }
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

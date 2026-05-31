#!/usr/bin/env node
// CLI: run a full round of pairwise duels across all current players for a
// scenario (or all scenarios). Each pair (including vs baseline) gets one duel.
//
// Usage:
//   ARENA_BASE_URL=https://openrank-arena.vercel.app \
//   ARENA_SHARED_PASSWORD=WANNABE_FOUNDERS \
//   ANTHROPIC_API_KEY=sk-ant-... \
//   node harness/round.mjs --scenario carryon
//
//   # all scenarios:
//   node harness/round.mjs --all
//
// With 5 players + baseline = 6 entrants, that's C(6,2) = 15 duels per scenario.
// At ~$0.05/duel (Sonnet), one full round across all 3 scenarios ≈ $2.25.
//
// Each duel is invoked by shelling out to duel.mjs, so behavior + sync are identical.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const duelScript = path.join(here, "duel.mjs");

const args = parseArgs(process.argv.slice(2));
const scenarioFilter = args.scenario;
const all = Boolean(args.all);

if (!scenarioFilter && !all) {
  console.error(`Usage:
  node harness/round.mjs --scenario <id>       # one scenario, all players
  node harness/round.mjs --all                  # all scenarios, all players

Scenarios: carryon, dental, aeo-tool
Baseline is automatically included as a fixed-Elo opponent.

Env:
  ARENA_BASE_URL (default: https://openrank-arena.vercel.app)
  ARENA_SHARED_PASSWORD
  ANTHROPIC_API_KEY
`);
  process.exit(1);
}

const baseUrl = (process.env.ARENA_BASE_URL || "https://openrank-arena.vercel.app").replace(/\/$/, "");

const scenarios = (await import("./scenarios.mjs")).scenarios;
const targetScenarios = all ? Object.keys(scenarios) : [scenarioFilter];

for (const sid of targetScenarios) {
  if (!scenarios[sid]) {
    console.error(`Unknown scenario: ${sid}`);
    continue;
  }
  await runRound(sid);
}

async function runRound(scenarioId) {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  Round: ${scenarios[scenarioId].label}`);
  console.log("═".repeat(70));

  const players = await fetchPlayersWithSubmissions(scenarioId);
  // Include baseline as a fixed entrant
  const entrants = [...players, "baseline"];

  if (entrants.length < 2) {
    console.log(`Not enough entrants (need at least 2, have ${entrants.length}). Skipping.`);
    return;
  }

  const pairs = [];
  for (let i = 0; i < entrants.length; i++) {
    for (let j = i + 1; j < entrants.length; j++) {
      pairs.push([entrants[i], entrants[j]]);
    }
  }

  console.log(`\nEntrants: ${entrants.join(", ")}`);
  console.log(`Pairs: ${pairs.length}\n`);

  let won = 0, lost = 0, tied = 0, errs = 0;
  for (const [a, b] of pairs) {
    console.log(`\n  Duel: ${a} vs ${b}`);
    const code = await spawnDuel(scenarioId, a, b);
    if (code !== 0) errs++;
  }

  console.log(`\nRound complete. ${pairs.length} duels, ${errs} errors.`);
}

async function fetchPlayersWithSubmissions(scenarioId) {
  // The leaderboard exposes submissions via the home page; we don't have a
  // public endpoint listing names yet, so call /api/leaderboard which returns
  // the per-scenario Elo board (players with at least one duel) — plus we
  // include any new players via /api/players-with-submissions.
  // For now we just hit the home-page-implicit list via /api/leaderboard.
  try {
    const res = await fetch(`${baseUrl}/api/players?scenario=${scenarioId}`);
    if (res.ok) {
      const data = await res.json();
      return data.players || [];
    }
  } catch {}
  // Fallback: scrape the home page for /players/<name>/ links
  try {
    const res = await fetch(`${baseUrl}/`);
    const html = await res.text();
    const matches = [...html.matchAll(new RegExp(`/players/([a-zA-Z0-9_-]+)/${scenarioId}\\b`, "g"))];
    return [...new Set(matches.map((m) => m[1]))];
  } catch {
    return [];
  }
}

function spawnDuel(scenarioId, a, b) {
  return new Promise((resolve) => {
    const proc = spawn(
      process.execPath,
      [duelScript, "--scenario", scenarioId, "--a", a, "--b", b],
      { stdio: "inherit", env: process.env }
    );
    proc.on("exit", (code) => resolve(code ?? 1));
  });
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

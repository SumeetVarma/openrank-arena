#!/usr/bin/env node
// CLI: run a full match across all current players (+ baseline) in a scenario,
// or across every scenario. This is just match.mjs --all, one per scenario.
//
// Usage:
//   ARENA_BASE_URL=https://openrank-arena.vercel.app \
//   ARENA_SHARED_PASSWORD=WANNABE_FOUNDERS \
//   ANTHROPIC_API_KEY=sk-ant-... \
//   node harness/round.mjs --scenario carryon
//
//   node harness/round.mjs --all

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const matchScript = path.join(here, "match.mjs");

const args = parseArgs(process.argv.slice(2));
const scenarioFilter = args.scenario;
const all = Boolean(args.all);

if (!scenarioFilter && !all) {
  console.error(`Usage:
  node harness/round.mjs --scenario <id>   # one scenario: all players + baseline
  node harness/round.mjs --all              # every scenario: all players + baseline
`);
  process.exit(1);
}

const scenarios = (await import("./scenarios.mjs")).scenarios;
const targetScenarios = all ? Object.keys(scenarios) : [scenarioFilter];

for (const sid of targetScenarios) {
  if (!scenarios[sid]) {
    console.error(`Unknown scenario: ${sid}`);
    continue;
  }
  console.log(`\n${"═".repeat(70)}\n  ${scenarios[sid].label}\n${"═".repeat(70)}`);
  await new Promise((resolve) => {
    const proc = spawn(
      process.execPath,
      [matchScript, "--scenario", sid, "--all"],
      { stdio: "inherit", env: process.env }
    );
    proc.on("exit", () => resolve());
  });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) out[key] = true;
      else { out[key] = next; i++; }
    }
  }
  return out;
}

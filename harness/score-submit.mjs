#!/usr/bin/env node
// Thin score uploader. Takes a judge result (already produced by some LLM —
// could be Claude-in-the-loop, Codex, or anything else) and posts it to
// `/api/match` so the Elo lands on the leaderboard.
//
// Usage:
//   node harness/score-submit.mjs --result result.json
//   node harness/score-submit.mjs --result -          # read JSON from stdin
//   node harness/score-submit.mjs \
//     --scenario carryon \
//     --ranking "alice,baseline" \
//     --kinds "alice=player,baseline=baseline" \
//     --rationale "Alice was tighter on specs."
//
// The result file format (preferred — what AI-in-the-loop should write):
//   {
//     "scenarioId": "carryon",
//     "ranking": ["alice", "baseline"],
//     "entrantKinds": { "alice": "player", "baseline": "baseline" },
//     "entrantVersions": { "alice": "01e197da" },   // REQUIRED for every player entrant
//     "rationale": "Alice was tighter on specs and didn't fabricate reviews.",
//     "signals": [
//       { "signal": "concrete_specifics", "best": "A", "worst": "B" }
//     ],
//     "model": "claude-code-in-the-loop"
//   }
//
// entrantVersions pins each player entrant to a specific submission version
// so the match record is reproducible. Baselines and incumbents don't need a
// pin (they don't change). If you don't know a player's version, query
// /api/players?name=<n>&scenario=<s> — the response includes latestVersion.
//
// The shared password defaults to `WANNABE_FOUNDERS` (the same default the
// /api/match route accepts). Override with ARENA_SHARED_PASSWORD if your
// deployment uses a different one.

import { readFile } from "node:fs/promises";
import os from "node:os";

const args = parseArgs(process.argv.slice(2));

let body;
if (args.result) {
  const raw = args.result === "-"
    ? await readStdin()
    : await readFile(args.result, "utf8");
  try {
    body = JSON.parse(raw);
  } catch (err) {
    fail(`Result file is not valid JSON: ${err.message}`);
  }
} else {
  // Build from CLI flags
  if (!args.scenario) fail("Missing --scenario");
  if (!args.ranking) fail("Missing --ranking (e.g. --ranking alice,baseline)");
  const ranking = String(args.ranking).split(",").map((s) => s.trim()).filter(Boolean);
  const kinds = {};
  if (args.kinds) {
    for (const pair of String(args.kinds).split(",")) {
      const [k, v] = pair.split("=").map((s) => s.trim());
      if (k && v) kinds[k] = v;
    }
  }
  // Default every entrant we don't know about to "player"
  for (const r of ranking) {
    if (!kinds[r]) kinds[r] = r === "baseline" ? "baseline" : "player";
  }
  const versions = {};
  if (args.versions) {
    for (const pair of String(args.versions).split(",")) {
      const [k, v] = pair.split("=").map((s) => s.trim());
      if (k && v) versions[k] = v;
    }
  }
  body = {
    scenarioId: args.scenario,
    ranking,
    entrantKinds: kinds,
    entrantVersions: versions,
    rationale: args.rationale || "",
    model: args.model || "manual",
    signals: []
  };
}

// Reproducibility: every player entrant must be pinned to a specific version.
const versions = body.entrantVersions || {};
for (const ref of body.ranking || []) {
  if (body.entrantKinds?.[ref] === "player" && !versions[ref]) {
    fail(`Missing entrantVersions["${ref}"] — every player entrant must be pinned to a submission version id. ` +
      `Query https://openrank-arena.vercel.app/api/players?scenario=${body.scenarioId}&name=${ref} for the latest version, or pass --versions ${ref}=<id>.`);
  }
}

// Required fields check
if (!body.scenarioId) fail("Payload missing scenarioId");
if (!Array.isArray(body.ranking) || body.ranking.length < 2) {
  fail("Payload needs a ranking array with ≥2 entrants");
}
if (!body.entrantKinds || typeof body.entrantKinds !== "object") {
  fail("Payload missing entrantKinds (map of entrant → 'player' | 'baseline' | 'incumbent')");
}

const baseUrl = (args["base-url"] || process.env.ARENA_BASE_URL || "https://openrank-arena.vercel.app").replace(/\/$/, "");
const sharedPassword = process.env.ARENA_SHARED_PASSWORD || "WANNABE_FOUNDERS";
const runner = args.runner || process.env.ARENA_RUNNER || os.userInfo().username || "anonymous";

const payload = {
  ...body,
  sharedPassword,
  runner
};

process.stdout.write(`Posting to ${baseUrl}/api/match ... `);
const res = await fetch(`${baseUrl}/api/match`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload)
});
const text = await res.text();
if (!res.ok) {
  process.stdout.write(`FAILED (${res.status})\n`);
  console.error(text);
  process.exit(1);
}
process.stdout.write("ok\n");

let result;
try { result = JSON.parse(text); } catch { result = { raw: text }; }

console.log("");
console.log(`  Match id:   ${result.matchId || "(no id returned)"}`);
console.log(`  Ranking:    ${body.ranking.join(" > ")}`);
console.log(`  Elo deltas:`);
for (const [name, change] of Object.entries(result.elo || {})) {
  const sign = change.delta >= 0 ? "+" : "";
  console.log(`    ${name.padEnd(20)} ${Math.round(change.before)} → ${Math.round(change.after)}  (${sign}${Math.round(change.delta)})`);
}
console.log("");
console.log(`  Live board: ${baseUrl}/#leaderboard`);

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

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function fail(msg) {
  console.error(`Error: ${msg}`);
  console.error("");
  console.error("Usage:");
  console.error("  node harness/score-submit.mjs --result result.json");
  console.error("  node harness/score-submit.mjs --result -   # JSON from stdin");
  console.error("  node harness/score-submit.mjs \\");
  console.error("    --scenario carryon --ranking alice,baseline \\");
  console.error("    --kinds alice=player,baseline=baseline \\");
  console.error("    --rationale 'Alice was tighter on specs.'");
  process.exit(1);
}

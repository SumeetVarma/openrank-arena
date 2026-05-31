#!/usr/bin/env node
// CLI: one-click claim a player name and create a v1 submission seeded from
// the scenario baseline. Mirrors the /api/start UI flow.
//
// Usage:
//   node harness/start.mjs --name alice --scenario carryon
//
// Optional:
//   --base-url https://openrank-arena.vercel.app   (or set ARENA_BASE_URL)
//
// Pairs with harness/submit.mjs for the rest of the iteration loop.

const args = parseArgs(process.argv.slice(2));
const name = args.name;
const scenario = args.scenario;
const baseUrl = (args["base-url"] || process.env.ARENA_BASE_URL || "").replace(/\/$/, "");

if (!name || !scenario) {
  console.error(`Usage:
  node harness/start.mjs --name <player> --scenario <id>

Scenarios: carryon, dental, aeo-tool

Examples:
  node harness/start.mjs --name alice --scenario carryon

Env:
  ARENA_BASE_URL (default: https://openrank-arena.vercel.app)
`);
  process.exit(1);
}

const BASE = baseUrl || "https://openrank-arena.vercel.app";

const form = new FormData();
form.append("name", name);
form.append("scenario", scenario);

const url = `${BASE}/api/start`;
process.stdout.write(`Claiming "${name}" and seeding v1 for "${scenario}" ... `);

let res, body;
try {
  res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json" },
    body: form
  });
  body = await res.text();
} catch (err) {
  console.log("FAILED");
  console.error(err.message);
  process.exit(1);
}

if (!res.ok) {
  console.log(`FAILED ${res.status}`);
  console.error(body.slice(0, 500));
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(body);
} catch {
  console.log("done (non-JSON response)");
  process.exit(0);
}

console.log("done");
console.log("");
console.log(`  Live URL:           ${BASE}${parsed.liveUrl}`);
console.log(`  Version:            ${parsed.version}`);
console.log(`  Starter zip:        ${BASE}${parsed.starterDownloadUrl}`);
console.log("");
console.log("Next: download the starter zip, edit it locally, then submit:");
console.log(`  curl -O ${BASE}${parsed.starterDownloadUrl}`);
console.log(`  unzip openrank-arena-${scenario}-starter.zip -d ${name}-${scenario}`);
console.log(`  # ...edit ${name}-${scenario}/index.html ...`);
console.log(`  node harness/submit.mjs --name ${name} --scenario ${scenario} --dir ${name}-${scenario}`);
console.log("");

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

#!/usr/bin/env node
// CLI: zip a folder and POST it to the OpenRank Arena /api/submit endpoint.
//
// Designed for LLM-driven workflows: a friend tells Claude/Codex/Cursor
// "submit my optimized page" and the agent runs this.
//
// Usage:
//   node harness/submit.mjs --name alice --scenario carryon --dir ./my-submission
//
// Optional:
//   --note "what I tried"
//   --private --password "view-token"       (mark submission password-protected)
//   --base-url https://openrank-arena.vercel.app
//
// Reads ARENA_BASE_URL from env if --base-url not passed.
//
// The folder must contain at minimum: index.html
// Optional: llms.txt, robots.txt, meta.json, assets/ subfolder.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = parseArgs(process.argv.slice(2));
const name = args.name;
const scenario = args.scenario;
const dir = args.dir;
const note = args.note || "";
const baseUrl = (args["base-url"] || process.env.ARENA_BASE_URL || "").replace(/\/$/, "");
const isPrivate = Boolean(args.private);
const submissionPassword = args.password || "";

if (!name || !scenario || !dir) {
  console.error(`Usage:
  node harness/submit.mjs --name <player> --scenario <id> --dir <folder> [--note "..."] [--private --password "..."]

Scenarios: carryon, dental, aeo-tool

Examples:
  node harness/submit.mjs --name alice --scenario carryon --dir ./my-page
  node harness/submit.mjs --name bob --scenario dental --dir ./bob-dental --note "added FAQ section"

Env:
  ARENA_BASE_URL (default: https://openrank-arena.vercel.app)
`);
  process.exit(1);
}

const BASE = baseUrl || "https://openrank-arena.vercel.app";

// 1. Validate dir
const abs = path.resolve(dir);
try {
  const stat = await fs.stat(abs);
  if (!stat.isDirectory()) throw new Error("not a directory");
} catch (err) {
  console.error(`Error: --dir "${dir}" must be an existing directory.`);
  process.exit(1);
}
const indexExists = await fs
  .stat(path.join(abs, "index.html"))
  .then(() => true)
  .catch(() => false);
if (!indexExists) {
  console.error(`Error: ${abs}/index.html is required.`);
  process.exit(1);
}

// 2. Zip the folder using JSZip (pulled from the leaderboard's node_modules)
const jszipPath = await resolveJSZip();
const { default: JSZip } = await import(jszipPath);
const zip = new JSZip();
await addFolderToZip(zip, abs, "");
const buffer = await zip.generateAsync({ type: "nodebuffer" });

console.log(`Zipped ${Object.keys(zip.files).length} entries (${buffer.length.toLocaleString()} bytes)`);

// 3. Build multipart form and POST
const form = new FormData();
form.append("name", name);
form.append("scenario", scenario);
form.append("note", note);
if (isPrivate) {
  form.append("isPasswordProtected", "on");
  form.append("submissionPassword", submissionPassword);
}
form.append("zip", new Blob([buffer], { type: "application/zip" }), "submission.zip");

const url = `${BASE}/api/submit`;
process.stdout.write(`Uploading to ${url} ... `);
let res, body;
try {
  res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json" }, // tells the route to return JSON, not redirect
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
  console.log(body.slice(0, 200));
  process.exit(0);
}

console.log("done");
console.log("");
console.log(`  Live URL:        ${BASE}${parsed.liveUrl}`);
console.log(`  Version:         ${parsed.version}`);
console.log(`  llms.txt:        ${BASE}${parsed.liveUrl}/llms.txt`);
console.log(`  Player profile:  ${BASE}/players/${name}`);
console.log("");

// ---- helpers ----

async function addFolderToZip(zip, absRoot, relPrefix) {
  const entries = await fs.readdir(absRoot, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const childAbs = path.join(absRoot, e.name);
    const childRel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      await addFolderToZip(zip, childAbs, childRel);
    } else if (e.isFile()) {
      const content = await fs.readFile(childAbs);
      zip.file(childRel, content);
    }
  }
}

async function resolveJSZip() {
  // Look up jszip in the leaderboard's node_modules (sibling dir).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "..", "leaderboard", "node_modules", "jszip", "lib", "index.js"),
    path.join(here, "node_modules", "jszip", "lib", "index.js")
  ];
  for (const c of candidates) {
    if (await fs.stat(c).then(() => true).catch(() => false)) return c;
  }
  console.error(
    "Error: jszip not found. Install dependencies first:\n  (cd leaderboard && npm install)\n  or  npm install jszip --prefix harness"
  );
  process.exit(1);
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

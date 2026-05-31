// Thin wrappers over Upstash Redis (Marketplace) + Vercel Blob. Falls back to
// in-memory if env not set (so local dev works without provisioning services).
//
// Versioning: every submission creates a new version. The latest version is
// served at /players/<name>/<scenario>; old versions live at
// /players/<name>/<scenario>/v/<version>.

import { Redis } from "@upstash/redis";
import { put, head } from "@vercel/blob";
import crypto from "node:crypto";

const HAS_KV = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
const HAS_BLOB = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

const redis = HAS_KV
  ? new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN
    })
  : null;

const memory = {
  players: new Map(),
  submissionVersions: new Map(), // key: `${name}:${scenario}` -> array of versions (newest first)
  scores: new Map(),
  scoresIndex: new Map()
};

// -------- Player --------
//
// Players are claimed on first write — no password. Any future submission
// under the same name overwrites the same player record. Anyone can use any
// name (5-friend trust model). Per-submission privacy is handled separately.

export async function ensurePlayer({ name }) {
  const key = String(name || "").trim().toLowerCase();
  if (!key) throw new Error("Player name required");
  const display = String(name).trim();
  if (HAS_KV) {
    const existing = await redis.get(`player:${key}`);
    if (existing) return existing;
    const record = { name: display, joinedAt: new Date().toISOString() };
    await redis.set(`player:${key}`, record);
    await redis.sadd("players:all", key);
    return record;
  } else {
    if (memory.players.has(key)) return memory.players.get(key);
    const record = { name: display, joinedAt: new Date().toISOString() };
    memory.players.set(key, record);
    return record;
  }
}

export async function getPlayer(name) {
  const key = String(name || "").trim().toLowerCase();
  if (HAS_KV) return (await redis.get(`player:${key}`)) || null;
  return memory.players.get(key) || null;
}

export async function listPlayers() {
  if (HAS_KV) {
    const keys = (await redis.smembers("players:all")) || [];
    if (!keys.length) return [];
    const records = await Promise.all(keys.map((k) => redis.get(`player:${k}`)));
    return records.filter(Boolean);
  }
  return [...memory.players.values()];
}

// -------- Submission Versions --------

function listKey(name, scenario) {
  return `submission:${String(name).toLowerCase()}:${scenario}:versions`;
}

function versionKey(name, scenario, version) {
  return `submission:${String(name).toLowerCase()}:${scenario}:v:${version}`;
}

function latestKey(name, scenario) {
  return `submission:${String(name).toLowerCase()}:${scenario}:latest`;
}

export async function appendSubmissionVersion({
  name,
  scenario,
  blobPath,
  isPasswordProtected,
  submissionPassword,
  note = ""
}) {
  const version = crypto.randomBytes(4).toString("hex");
  const record = {
    name,
    scenario,
    version,
    blobPath,
    uploadedAt: new Date().toISOString(),
    isPasswordProtected: Boolean(isPasswordProtected),
    submissionPasswordHash: submissionPassword ? hash(submissionPassword) : null,
    note: String(note || "").slice(0, 280)
  };

  if (HAS_KV) {
    await redis.set(versionKey(name, scenario, version), record);
    await redis.lpush(listKey(name, scenario), version);
    await redis.set(latestKey(name, scenario), version);
    await redis.sadd(`scenario:${scenario}:submissions`, String(name).toLowerCase());
  } else {
    const k = `${String(name).toLowerCase()}:${scenario}`;
    const list = memory.submissionVersions.get(k) || [];
    list.unshift(record);
    memory.submissionVersions.set(k, list);
  }
  return record;
}

export async function getLatestSubmission(name, scenario) {
  if (HAS_KV) {
    const version = await redis.get(latestKey(name, scenario));
    if (!version) return null;
    return await redis.get(versionKey(name, scenario, version));
  }
  const list = memory.submissionVersions.get(`${String(name).toLowerCase()}:${scenario}`) || [];
  return list[0] || null;
}

export async function getSubmissionVersion(name, scenario, version) {
  if (HAS_KV) return (await redis.get(versionKey(name, scenario, version))) || null;
  const list = memory.submissionVersions.get(`${String(name).toLowerCase()}:${scenario}`) || [];
  return list.find((s) => s.version === version) || null;
}

export async function listSubmissionVersions(name, scenario) {
  if (HAS_KV) {
    const versions = (await redis.lrange(listKey(name, scenario), 0, 99)) || [];
    if (!versions.length) return [];
    const records = await Promise.all(versions.map((v) => redis.get(versionKey(name, scenario, v))));
    return records.filter(Boolean);
  }
  return memory.submissionVersions.get(`${String(name).toLowerCase()}:${scenario}`) || [];
}

export async function listLatestSubmissionsForScenario(scenario) {
  if (HAS_KV) {
    const names = (await redis.smembers(`scenario:${scenario}:submissions`)) || [];
    if (!names.length) return [];
    const records = await Promise.all(names.map((n) => getLatestSubmission(n, scenario)));
    return records.filter(Boolean);
  }
  const out = [];
  for (const [k, list] of memory.submissionVersions) {
    if (k.endsWith(`:${scenario}`) && list.length) out.push(list[0]);
  }
  return out;
}

export function verifySubmissionPassword(submission, password) {
  if (!submission?.isPasswordProtected) return true;
  if (!submission?.submissionPasswordHash) return true;
  return submission.submissionPasswordHash === hash(password || "");
}

// -------- Blob (zipped submission contents) --------

export async function uploadZip({ name, scenario, version, buffer }) {
  const filename = `${version}.zip`;
  const path = `submissions/${String(name).toLowerCase()}/${scenario}/${filename}`;
  if (HAS_BLOB) {
    const { url, pathname } = await put(path, buffer, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: false
    });
    return { url, pathname };
  }
  // No Blob configured. On Vercel this would crash because the runtime fs is
  // read-only; instead surface a clear configuration error.
  if (process.env.VERCEL || process.env.NEXT_PUBLIC_VERCEL_URL) {
    throw new Error(
      "Storage not configured: Vercel Blob is connected to this project but BLOB_READ_WRITE_TOKEN is not set in env. Open Vercel → project → Storage → Blob → 'Connect to project' → confirm the token is injected, then redeploy."
    );
  }
  // Local dev only
  const fs = await import("node:fs/promises");
  const pathMod = await import("node:path");
  const dest = pathMod.resolve(process.cwd(), ".blob-store", path);
  await fs.mkdir(pathMod.dirname(dest), { recursive: true });
  await fs.writeFile(dest, buffer);
  return { url: `file://${dest}`, pathname: path };
}

export async function fetchZip(blobPath) {
  if (HAS_BLOB) {
    const meta = await head(blobPath);
    const res = await fetch(meta.url);
    return Buffer.from(await res.arrayBuffer());
  }
  const fs = await import("node:fs/promises");
  const pathMod = await import("node:path");
  const local = pathMod.resolve(process.cwd(), ".blob-store", blobPath);
  return await fs.readFile(local);
}

// -------- Scores --------

export async function saveScore({ scenario, runId, payload }) {
  const key = `score:${scenario}:${runId}`;
  if (HAS_KV) {
    await redis.set(key, payload);
    await redis.lpush(`scores:${scenario}`, runId);
    await redis.ltrim(`scores:${scenario}`, 0, 99);
  } else {
    memory.scores.set(key, payload);
    const list = memory.scoresIndex.get(scenario) || [];
    list.unshift(runId);
    memory.scoresIndex.set(scenario, list.slice(0, 100));
  }
}

export async function getRecentScores(scenario, limit = 20) {
  if (HAS_KV) {
    const ids = (await redis.lrange(`scores:${scenario}`, 0, limit - 1)) || [];
    if (!ids.length) return [];
    const records = await Promise.all(ids.map((id) => redis.get(`score:${scenario}:${id}`)));
    return records.filter(Boolean);
  }
  const ids = (memory.scoresIndex.get(scenario) || []).slice(0, limit);
  return ids.map((id) => memory.scores.get(`score:${scenario}:${id}`)).filter(Boolean);
}

// -------- Helpers --------

function hash(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

export function newRunId() {
  return crypto.randomBytes(6).toString("hex");
}

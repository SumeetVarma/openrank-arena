// Accepts an N-way bout result (ranking of multiple players) and derives all
// pairwise Elo updates from the ordering. One bout = C(N,2) Elo applications.

import { Redis } from "@upstash/redis";
import { applyDuel, BASELINE_NAME } from "../../../lib/elo.mjs";
import { ensurePlayer, newRunId } from "../../../lib/storage.mjs";
import { scenarios } from "../../../lib/scenarios.mjs";

export const runtime = "nodejs";

const HAS_KV = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
const redis = HAS_KV
  ? new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN
    })
  : null;

export async function POST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const {
    sharedPassword,
    scenarioId,
    ranking,
    model,
    rationale,
    signals,
    runner,
    rawText
  } = payload || {};

  const expected = process.env.ARENA_SHARED_PASSWORD || "WANNABE_FOUNDERS";
  if (sharedPassword !== expected) {
    return json({ ok: false, error: "Wrong shared password" }, 401);
  }
  if (!scenarios[scenarioId]) return json({ ok: false, error: "Unknown scenario" }, 400);
  if (!Array.isArray(ranking) || ranking.length < 2) {
    return json({ ok: false, error: "Need a ranking with at least 2 players" }, 400);
  }

  // Ensure all named players exist (skip baseline)
  for (const p of ranking) {
    if (p !== BASELINE_NAME) await ensurePlayer({ name: p });
  }

  // For each consecutive pair in the ranking, apply Elo as A_wins.
  // Actually: for ALL pairs (not just consecutive) — higher-ranked beats lower-ranked.
  // This gives every player full credit for who they beat / who beat them.
  const eloChanges = {};
  for (let i = 0; i < ranking.length; i++) {
    for (let j = i + 1; j < ranking.length; j++) {
      const winner = ranking[i];
      const loser = ranking[j];
      if (winner === loser) continue;
      const result = await applyDuel({
        redis,
        scenarioId,
        playerA: winner,
        playerB: loser,
        outcome: "A_wins"
      });
      // Merge into eloChanges, keeping first 'before' and latest 'after'
      for (const [p, change] of Object.entries(result)) {
        if (!eloChanges[p]) {
          eloChanges[p] = { before: change.before, after: change.after, delta: change.delta };
        } else {
          eloChanges[p].after = change.after;
          eloChanges[p].delta = eloChanges[p].after - eloChanges[p].before;
        }
      }
    }
  }

  const boutId = newRunId();
  const record = {
    boutId,
    scenarioId,
    ranking,
    model,
    rationale: String(rationale || "").slice(0, 800),
    signals: signals || [],
    runner: String(runner || "anonymous").slice(0, 120),
    ranAt: new Date().toISOString(),
    elo: eloChanges
  };

  if (redis) {
    await redis.set(`bout:${scenarioId}:${boutId}`, record);
    await redis.lpush(`bouts:${scenarioId}:recent`, boutId);
    await redis.ltrim(`bouts:${scenarioId}:recent`, 0, 199);
  }

  return json({ ok: true, boutId, elo: eloChanges });
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

// Accepts a parsed pairwise duel result from a local harness invocation,
// updates Elo for both players, and persists the duel log.
//
// The harness posts here automatically after every duel so the leaderboard
// reflects results in real time.

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
    a,
    b,
    winner,
    loser,
    model,
    rationale,
    signalCalled,
    runner,
    rawText
  } = payload || {};

  const expected = process.env.ARENA_SHARED_PASSWORD || "WANNABE_FOUNDERS";
  if (sharedPassword !== expected) {
    return json({ ok: false, error: "Wrong shared password" }, 401);
  }
  if (!scenarios[scenarioId]) return json({ ok: false, error: "Unknown scenario" }, 400);
  if (!a || !b || a === b) return json({ ok: false, error: "Invalid players" }, 400);

  // Ensure both players exist (skip for baseline)
  if (a !== BASELINE_NAME) await ensurePlayer({ name: a });
  if (b !== BASELINE_NAME) await ensurePlayer({ name: b });

  const isTie = winner === "tie";
  const outcome = isTie ? "tie" : winner === a ? "A_wins" : "B_wins";

  const elo = await applyDuel({
    redis,
    scenarioId,
    playerA: a,
    playerB: b,
    outcome
  });

  const duelId = newRunId();
  const record = {
    duelId,
    scenarioId,
    a,
    b,
    winner: isTie ? "tie" : winner,
    loser: isTie ? "tie" : loser,
    outcome,
    model,
    rationale: String(rationale || "").slice(0, 800),
    signals: signalCalled || [],
    runner: String(runner || "anonymous").slice(0, 120),
    ranAt: new Date().toISOString(),
    elo
  };

  if (redis) {
    await redis.set(`duel:${scenarioId}:${duelId}`, record);
    await redis.lpush(`duels:${scenarioId}:recent`, duelId);
    await redis.ltrim(`duels:${scenarioId}:recent`, 0, 199);
    await redis.lpush(`duels:all:recent`, `${scenarioId}/${duelId}`);
    await redis.ltrim(`duels:all:recent`, 0, 199);
  }

  return json({ ok: true, duelId, elo });
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

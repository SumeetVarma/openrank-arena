// Accept a match result (ranking of N≥2 entrants), derive all pairwise Elo
// updates from the ordering, persist the match log.
//
// Entrants can be any mix of: players, "baseline", or incumbent slugs.
// We only update Elo for players and baseline (incumbents are fixed market
// fixtures — they don't have Elo records of their own).

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
    entrantKinds = {},
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
    return json({ ok: false, error: "Need a ranking with at least 2 entrants" }, 400);
  }

  // Ensure player records exist for any 'player' kind entrants
  for (const ref of ranking) {
    if (entrantKinds[ref] === "player") {
      await ensurePlayer({ name: ref });
    }
  }

  // For each consecutive pair in the ranking, apply Elo. Higher-ranked beats
  // lower-ranked. Skip pairs where neither entrant has an Elo record
  // (incumbent-vs-incumbent — meaningless).
  const eloChanges = {};
  const eligible = (ref) =>
    entrantKinds[ref] === "player" || ref === BASELINE_NAME || entrantKinds[ref] === "baseline";

  for (let i = 0; i < ranking.length; i++) {
    for (let j = i + 1; j < ranking.length; j++) {
      const winner = ranking[i];
      const loser = ranking[j];
      if (winner === loser) continue;
      // Skip pure incumbent matchups — no Elo to update
      if (!eligible(winner) && !eligible(loser)) continue;

      const result = await applyDuel({
        redis,
        scenarioId,
        playerA: winner,
        playerB: loser,
        outcome: "A_wins"
      });
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

  const matchId = newRunId();
  const record = {
    matchId,
    scenarioId,
    ranking,
    entrantKinds,
    model,
    rationale: String(rationale || "").slice(0, 800),
    signals: signals || [],
    runner: String(runner || "anonymous").slice(0, 120),
    ranAt: new Date().toISOString(),
    elo: eloChanges
  };

  if (redis) {
    await redis.set(`match:${scenarioId}:${matchId}`, record);
    await redis.lpush(`matches:${scenarioId}:recent`, matchId);
    await redis.ltrim(`matches:${scenarioId}:recent`, 0, 199);
  }

  return json({ ok: true, matchId, elo: eloChanges });
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

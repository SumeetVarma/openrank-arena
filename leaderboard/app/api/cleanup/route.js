// Admin: delete a player (and all their submissions + Elo) by name.
// Gated by ARENA_SHARED_PASSWORD.
//
// Usage:
//   curl -X POST https://openrank-arena.vercel.app/api/cleanup \
//     -H "Content-Type: application/json" \
//     -d '{"sharedPassword":"WANNABE_FOUNDERS","names":["playwright-test","s","test123"]}'

import { Redis } from "@upstash/redis";
import { scenarioIds } from "../../../lib/scenarios.mjs";

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

  const { sharedPassword, names } = payload || {};
  const expected = process.env.ARENA_SHARED_PASSWORD || "WANNABE_FOUNDERS";
  if (sharedPassword !== expected) {
    return json({ ok: false, error: "Wrong shared password" }, 401);
  }
  if (!Array.isArray(names) || !names.length) {
    return json({ ok: false, error: "Need an array of player names to delete" }, 400);
  }
  if (!redis) {
    return json({ ok: false, error: "KV not configured" }, 500);
  }

  const deleted = [];

  // Orphan-Elo audit: wipe any (player, scenario) Elo + duel entries where
  // the player has no submission for that scenario. Triggered by passing
  // names:["__orphans__"] — handled separately from named-player deletion.
  if (names.length === 1 && names[0] === "__orphans__") {
    const orphans = [];
    const allPlayers = (await redis.smembers("players:all")) || [];
    for (const name of allPlayers) {
      const eloHash = (await redis.hgetall(`elo:${name}`)) || {};
      const duelsHash = (await redis.hgetall(`duels:${name}`)) || {};
      const fieldsToCheck = new Set([...Object.keys(eloHash), ...Object.keys(duelsHash)]);
      for (const scenario of fieldsToCheck) {
        if (scenario === "overall") continue;
        if (!scenarioIds.includes(scenario)) continue;
        const latest = await redis.get(`submission:${name}:${scenario}:latest`);
        if (!latest) {
          // No submission for this scenario → wipe the orphan Elo + duel field
          await redis.hdel(`elo:${name}`, scenario);
          await redis.hdel(`duels:${name}`, scenario);
          orphans.push({ name, scenario });
        }
      }
    }
    return json({ ok: true, orphansWiped: orphans });
  }

  for (const raw of names) {
    const name = String(raw).toLowerCase().trim();
    if (!name) continue;
    // Remove the player record + roster membership
    await redis.del(`player:${name}`);
    await redis.srem("players:all", name);
    // Remove Elo + duels
    await redis.del(`elo:${name}`);
    await redis.del(`duels:${name}`);
    // Remove submissions across all scenarios
    for (const scenario of scenarioIds) {
      // Get version list, drop each
      const versions = (await redis.lrange(`submission:${name}:${scenario}:versions`, 0, 999)) || [];
      for (const v of versions) {
        await redis.del(`submission:${name}:${scenario}:v:${v}`);
      }
      await redis.del(`submission:${name}:${scenario}:versions`);
      await redis.del(`submission:${name}:${scenario}:latest`);
      await redis.srem(`scenario:${scenario}:submissions`, name);
    }
    deleted.push(name);
  }

  return json({ ok: true, deleted });
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

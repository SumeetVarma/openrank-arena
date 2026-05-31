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

// Returns Elo standings: per-scenario boards + combined overall.
//
// Used by the home page leaderboard. Caches briefly so repeat visits are fast.

import { Redis } from "@upstash/redis";
import { getLeaderboard, getOverallLeaderboard } from "../../../lib/elo.mjs";
import { scenarioIds } from "../../../lib/scenarios.mjs";

export const runtime = "nodejs";

const HAS_KV = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
const redis = HAS_KV
  ? new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN
    })
  : null;

export async function GET() {
  const perScenario = {};
  for (const id of scenarioIds) {
    perScenario[id] = await getLeaderboard(redis, id);
  }
  const overall = await getOverallLeaderboard(redis);
  return new Response(JSON.stringify({ overall, perScenario }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=10"
    }
  });
}

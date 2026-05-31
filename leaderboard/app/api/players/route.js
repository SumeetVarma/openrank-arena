// Lists players for a scenario. Without ?name= → returns just the player list
// (used by harness/round.mjs to know who to duel). With ?name= → returns that
// player's per-scenario Elo + duel count so the submit skill can decide
// whether to auto-trigger a first-time match.

import {
  listLatestSubmissionsForScenario
} from "../../../lib/storage.mjs";
import { scenarios } from "../../../lib/scenarios.mjs";
import { Redis } from "@upstash/redis";
import { getEloFor, getDuelsFor, SEED_ELO } from "../../../lib/elo.mjs";

export const runtime = "nodejs";

const HAS_KV = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
const redis = HAS_KV
  ? new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN
    })
  : null;

export async function GET(request) {
  const url = new URL(request.url);
  const scenario = url.searchParams.get("scenario");
  const name = url.searchParams.get("name");
  if (!scenario || !scenarios[scenario]) {
    return new Response(JSON.stringify({ ok: false, error: "Unknown scenario" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }
  const subs = await listLatestSubmissionsForScenario(scenario);

  if (name) {
    const elo = await getEloFor(redis, name, scenario);
    const duels = await getDuelsFor(redis, name, scenario);
    const submission = subs.find((s) => s.name === name) || null;
    return new Response(
      JSON.stringify({
        name,
        scenario,
        elo,
        duels,
        hasSubmission: Boolean(submission),
        latestVersion: submission?.version || null,
        seedElo: SEED_ELO
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
      }
    );
  }

  return new Response(
    JSON.stringify({ players: subs.map((s) => s.name) }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    }
  );
}

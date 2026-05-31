// Lists players with at least one submission in a given scenario.
// Used by harness/round.mjs to know who to duel.

import {
  listLatestSubmissionsForScenario
} from "../../../lib/storage.mjs";
import { scenarios } from "../../../lib/scenarios.mjs";

export const runtime = "nodejs";

export async function GET(request) {
  const url = new URL(request.url);
  const scenario = url.searchParams.get("scenario");
  if (!scenario || !scenarios[scenario]) {
    return new Response(JSON.stringify({ ok: false, error: "Unknown scenario" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }
  const subs = await listLatestSubmissionsForScenario(scenario);
  return new Response(
    JSON.stringify({ players: subs.map((s) => s.name) }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    }
  );
}

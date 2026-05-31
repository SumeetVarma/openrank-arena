// Accepts a parsed judge run from a local harness invocation and saves it to KV.
// The harness posts to this endpoint automatically after every run, so all
// results are synced back to the deployed site.

import { saveScore, newRunId } from "../../../lib/storage.mjs";
import { scenarios } from "../../../lib/scenarios.mjs";

export const runtime = "nodejs";

export async function POST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const { sharedPassword, scenarioId, run, scores, runner } = payload || {};

  const expected = process.env.ARENA_SHARED_PASSWORD || "WANNABE_FOUNDERS";
  if (sharedPassword !== expected) {
    return json({ ok: false, error: "Wrong shared password" }, 401);
  }
  if (!scenarios[scenarioId]) {
    return json({ ok: false, error: "Unknown scenario" }, 400);
  }
  if (!run || !run.parsed || !Array.isArray(run.labeled)) {
    return json({ ok: false, error: "Missing run.parsed or run.labeled" }, 400);
  }

  const runId = newRunId();
  await saveScore({
    scenario: scenarioId,
    runId,
    payload: {
      runId,
      scenarioId,
      ranAt: new Date().toISOString(),
      runner: String(runner || "anonymous").slice(0, 120),
      model: run.model,
      buyerQuery: run.buyerQuery,
      pick: run.parsed.pick,
      ranking: run.parsed.ranking,
      reasoning_per_page: run.parsed.reasoning_per_page,
      fabrication_flags: run.parsed.fabrication_flags,
      labeled: run.labeled,
      scores: scores || {}
    }
  });

  return json({ ok: true, runId });
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

// Accept a match result (ranking of N≥2 entrants), derive all pairwise Elo
// updates from the ordering, persist the match log.
//
// Entrants can be any mix of: players, "baseline", or incumbent slugs.
// We only update Elo for players and baseline (incumbents are fixed market
// fixtures — they don't have Elo records of their own).
//
// Reliability guards on this endpoint:
//   1. Every player entrant must be pinned to a specific submission version
//      (entrantVersions) so the match record is reproducible.
//   2. Every player entrant must have a current submission for the scenario
//      (anti-orphan).
//   3. No duplicate entrants in the ranking — exception: explicit ties in
//      the optional `ties` array.
//   4. Idempotent on (scenario, sorted entrant versions): if a match for the
//      same fingerprint already exists, this re-judgment is logged for
//      transparency but does NOT update Elo. Re-judging unchanged content
//      shouldn't compound Elo — submit a new version to earn more.

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
    ties = [],
    entrantKinds = {},
    entrantVersions = {},
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

  // Validate the ranking. Duplicates are only allowed if they appear in the
  // `ties` array (which is a list of arrays of entrant labels that tied).
  const tieGroups = Array.isArray(ties) ? ties.filter((g) => Array.isArray(g) && g.length >= 2) : [];
  const tiedSet = new Set(tieGroups.flat());
  const seen = new Set();
  for (const ref of ranking) {
    if (typeof ref !== "string" || !ref.trim()) {
      return json({ ok: false, error: `Ranking entry must be a non-empty string, got ${JSON.stringify(ref)}` }, 400);
    }
    if (seen.has(ref) && !tiedSet.has(ref)) {
      return json({
        ok: false,
        error: `Duplicate entrant "${ref}" in ranking. To indicate a tie, list each entrant once in ranking AND include the tied pair/group in the optional "ties": [["a","b"], ...] array.`
      }, 400);
    }
    seen.add(ref);
  }

  // Reproducibility: every player entrant in the ranking MUST be pinned to a
  // specific submission version.
  for (const ref of ranking) {
    if (entrantKinds[ref] === "player" && !entrantVersions[ref]) {
      return json({
        ok: false,
        error: `Missing entrantVersions["${ref}"] — every player entrant must be pinned to a submission version id`
      }, 400);
    }
  }

  // Anti-orphan: every player entrant must have a current submission.
  if (redis) {
    for (const ref of ranking) {
      if (entrantKinds[ref] !== "player") continue;
      const latest = await redis.get(`submission:${String(ref).toLowerCase()}:${scenarioId}:latest`);
      if (!latest) {
        return json({
          ok: false,
          error: `Player "${ref}" has no submission for scenario "${scenarioId}". Submit a page first, then run the match.`
        }, 400);
      }
    }
  }

  // Idempotency fingerprint: same scenario + same sorted entrant labels +
  // same versions = same matchup. If we've already paid out Elo for this
  // exact tuple, this re-judgment is a replay and gets logged WITHOUT
  // moving Elo.
  const fingerprint = buildFingerprint({ scenarioId, ranking, entrantVersions, entrantKinds });
  let alreadyJudged = false;
  if (redis) {
    const prior = await redis.get(`match:fingerprint:${fingerprint}`);
    if (prior) alreadyJudged = true;
  }

  // Ensure player records exist for any 'player' kind entrants
  for (const ref of ranking) {
    if (entrantKinds[ref] === "player") {
      await ensurePlayer({ name: ref });
    }
  }

  const eligible = (ref) =>
    entrantKinds[ref] === "player" || ref === BASELINE_NAME || entrantKinds[ref] === "baseline";

  // Build a tie-aware position map: same position = tied, lower index = higher rank.
  // Default: every entrant in ranking gets its index as its position.
  const positionOf = new Map();
  ranking.forEach((ref, i) => positionOf.set(ref, i));
  // For each tie group, snap all members to the position of the highest-ranked one.
  for (const group of tieGroups) {
    const positions = group.map((g) => positionOf.get(g)).filter((p) => p !== undefined);
    if (!positions.length) continue;
    const minPos = Math.min(...positions);
    for (const g of group) {
      if (positionOf.has(g)) positionOf.set(g, minPos);
    }
  }

  const eloChanges = {};

  if (!alreadyJudged) {
    // For each unordered pair, apply Elo based on relative position.
    // Skip pure-incumbent and pure-baseline-vs-baseline pairs (no Elo state to move).
    for (let i = 0; i < ranking.length; i++) {
      for (let j = i + 1; j < ranking.length; j++) {
        const a = ranking[i];
        const b = ranking[j];
        if (a === b) continue;
        if (!eligible(a) && !eligible(b)) continue;

        const posA = positionOf.get(a);
        const posB = positionOf.get(b);
        let outcome;
        if (posA === posB) outcome = "tie";
        else if (posA < posB) outcome = "A_wins";
        else outcome = "B_wins";

        const result = await applyDuel({
          redis,
          scenarioId,
          playerA: a,
          playerB: b,
          outcome
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
  }

  const matchId = newRunId();
  const record = {
    matchId,
    scenarioId,
    ranking,
    ties: tieGroups,
    entrantKinds,
    entrantVersions,
    model,
    rationale: String(rationale || "").slice(0, 800),
    signals: signals || [],
    runner: String(runner || "anonymous").slice(0, 120),
    ranAt: new Date().toISOString(),
    elo: eloChanges,
    replay: alreadyJudged,
    fingerprint
  };

  if (redis) {
    await redis.set(`match:${scenarioId}:${matchId}`, record);
    await redis.lpush(`matches:${scenarioId}:recent`, matchId);
    await redis.ltrim(`matches:${scenarioId}:recent`, 0, 199);
    // First time we see this fingerprint, claim it so future re-judgments
    // of identical content land as replays.
    if (!alreadyJudged) {
      await redis.set(`match:fingerprint:${fingerprint}`, matchId);
    }
  }

  return json({ ok: true, matchId, elo: eloChanges, replay: alreadyJudged });
}

function buildFingerprint({ scenarioId, ranking, entrantVersions, entrantKinds }) {
  // Sort entrants alphabetically so the order doesn't matter — what matters
  // is "who was on this matchup with what content."
  const parts = [...new Set(ranking)].sort().map((ref) => {
    const kind = entrantKinds[ref] || (ref === "baseline" ? "baseline" : "player");
    const v = entrantVersions[ref] || "";
    return `${ref}|${kind}|${v}`;
  });
  return `${scenarioId}::${parts.join("::")}`;
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

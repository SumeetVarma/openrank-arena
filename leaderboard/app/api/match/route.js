// Accept a match result (ranking of N≥2 entrants), derive all pairwise Elo
// updates from the ordering, persist the match log.
//
// Entrants can be any mix of: players, "baseline", or incumbent slugs.
// Mutable sides (ratings can move): players. Fixed sides: baseline + incumbents.
//
// Reliability guards on this endpoint:
//   1. entrantKinds must be specified explicitly for every ranked entrant.
//      Unknown / missing kinds are rejected.
//   2. Every player entrant must be pinned to a specific submission version
//      (entrantVersions) so the match record is reproducible.
//   3. Every player entrant must have a current submission for the scenario.
//   4. No duplicate entrants in the ranking — period. To indicate a tie, list
//      each entrant once in `ranking` AND include the tied group in `ties`.
//   5. Atomic idempotency on (scenario, sorted unique entrants, kinds, versions):
//      first writer wins the fingerprint key via SET NX; subsequent identical
//      matchups log as replay:true with NO Elo movement.

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

const VALID_KINDS = new Set(["player", "baseline", "incumbent"]);

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

  // STRICT: no duplicate entrants in ranking. Ties are expressed via the
  // optional `ties: [["a","b"], ...]` array, which references entrants that
  // each appear ONCE in ranking. ranking is otherwise a strict permutation.
  const seen = new Set();
  for (const ref of ranking) {
    if (typeof ref !== "string" || !ref.trim()) {
      return json({ ok: false, error: `Ranking entry must be a non-empty string, got ${JSON.stringify(ref)}` }, 400);
    }
    if (seen.has(ref)) {
      return json({
        ok: false,
        error: `Duplicate entrant "${ref}" in ranking. List each entrant once; use the "ties": [["a","b"], ...] field to mark same-position groups.`
      }, 400);
    }
    seen.add(ref);
  }

  // Validate the ties payload references only entrants in ranking and has
  // groups of at least 2. Duplicates within a single group are noise — dedup.
  const tieGroups = [];
  if (Array.isArray(ties)) {
    for (const rawGroup of ties) {
      if (!Array.isArray(rawGroup)) continue;
      const group = [...new Set(rawGroup.filter((g) => typeof g === "string" && seen.has(g)))];
      if (group.length >= 2) tieGroups.push(group);
    }
  }

  // STRICT: entrantKinds must be specified for every ranked entrant and be a
  // valid kind. No label-based guessing at the API boundary.
  for (const ref of ranking) {
    const kind = entrantKinds[ref];
    if (!VALID_KINDS.has(kind)) {
      return json({
        ok: false,
        error: `entrantKinds["${ref}"] must be one of ${[...VALID_KINDS].join(" | ")}; got ${JSON.stringify(kind)}`
      }, 400);
    }
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

  // Ensure player records exist for any 'player' kind entrants.
  for (const ref of ranking) {
    if (entrantKinds[ref] === "player") {
      await ensurePlayer({ name: ref });
    }
  }

  // Position map for tie-aware pairwise outcomes.
  const positionOf = new Map();
  ranking.forEach((ref, i) => positionOf.set(ref, i));
  for (const group of tieGroups) {
    const positions = group.map((g) => positionOf.get(g)).filter((p) => p !== undefined);
    if (!positions.length) continue;
    const minPos = Math.min(...positions);
    for (const g of group) {
      if (positionOf.has(g)) positionOf.set(g, minPos);
    }
  }

  // Atomic idempotency claim: SET NX with a recoverable matchId. If another
  // identical-fingerprint match already exists, we'll write THIS request as
  // a replay (no Elo) but still log it for transparency.
  const fingerprint = buildFingerprint({ scenarioId, ranking, entrantVersions, entrantKinds });
  const matchId = newRunId();
  let isReplay = false;
  let priorMatchId = null;
  if (redis) {
    // Upstash: SET with NX flag = only-if-not-exists
    const claimed = await redis.set(`match:fingerprint:${fingerprint}`, matchId, { nx: true });
    if (!claimed) {
      isReplay = true;
      priorMatchId = await redis.get(`match:fingerprint:${fingerprint}`);
    }
  }

  // A side is "mutable" (its Elo can move) only when entrantKinds says "player".
  // Baselines and incumbents are fixed fixtures — their ratings are pegged.
  const mutable = (ref) => entrantKinds[ref] === "player";

  const eloChanges = {};

  if (!isReplay) {
    // For each unordered pair, apply Elo based on relative position.
    // Skip pairs where neither side is mutable — no Elo state to move.
    for (let i = 0; i < ranking.length; i++) {
      for (let j = i + 1; j < ranking.length; j++) {
        const a = ranking[i];
        const b = ranking[j];
        const mA = mutable(a);
        const mB = mutable(b);
        if (!mA && !mB) continue;

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
          outcome,
          mutableA: mA,
          mutableB: mB
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
    replay: isReplay,
    priorMatchId,
    fingerprint
  };

  if (redis) {
    await redis.set(`match:${scenarioId}:${matchId}`, record);
    await redis.lpush(`matches:${scenarioId}:recent`, matchId);
    await redis.ltrim(`matches:${scenarioId}:recent`, 0, 199);
  }

  return json({ ok: true, matchId, elo: eloChanges, replay: isReplay, priorMatchId });
}

function buildFingerprint({ scenarioId, ranking, entrantVersions, entrantKinds }) {
  // Order-agnostic fingerprint over the matchup IDENTITY (which pages were on
  // the table), not the outcome. Sorted alphabetically so [a,b] == [b,a].
  const parts = [...new Set(ranking)].sort().map((ref) => {
    const kind = entrantKinds[ref];
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

// Elo rating computation for OpenRank Arena duels.
//
// Anchors:
//   - Baseline starts at 1000 and never moves. It's the fixed reference.
//   - New players seed at 1000.
//   - K-factor: 32 for players with < 10 duels (provisional), 16 after.
//
// Goal: a strong AEO playbook should be able to push Elo toward 2000.

import {
  getPlayer,
  ensurePlayer,
  listPlayers
} from "./storage.mjs";

export const BASELINE_NAME = "baseline";
export const SEED_ELO = 1000;
export const PROVISIONAL_K = 32;
export const ESTABLISHED_K = 16;
export const PROVISIONAL_DUELS = 10;

// Per-scenario Elo: { scenarioId: rating, "overall": rating }
// Stored as redis hash under elo:<player>

import { kv as _unused } from "@upstash/redis"; // type-only

export async function getEloFor(redis, player, scenarioId) {
  if (player === BASELINE_NAME) return SEED_ELO;
  const key = `elo:${String(player).toLowerCase()}`;
  if (!redis) return SEED_ELO;
  const rating = await redis.hget(key, scenarioId);
  // hget returns null when the field is missing — that's a fresh player and we
  // need to return SEED_ELO. Number(null) is 0 (finite) so we must check null
  // explicitly before coercing.
  if (rating === null || rating === undefined) return SEED_ELO;
  const n = Number(rating);
  return Number.isFinite(n) ? n : SEED_ELO;
}

export async function getDuelsFor(redis, player, scenarioId) {
  if (player === BASELINE_NAME) return Infinity; // baseline is fully established
  if (!redis) return 0;
  const key = `duels:${String(player).toLowerCase()}`;
  const count = await redis.hget(key, scenarioId);
  if (count === null || count === undefined) return 0;
  const n = Number(count);
  return Number.isFinite(n) ? n : 0;
}

export function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export function kFactor(duelsCount) {
  return duelsCount < PROVISIONAL_DUELS ? PROVISIONAL_K : ESTABLISHED_K;
}

// Apply a duel result. Returns the new ratings + deltas.
//   outcome: "A_wins" | "B_wins" | "tie"
//   mutableA / mutableB: defaults true. Set false for entrants whose rating must
//     NOT move (incumbents are fixtures; baseline is the 1000 anchor). Without
//     this, /api/match would silently mutate incumbent Elo records even though
//     incumbents aren't supposed to have ratings of their own.
export async function applyDuel({ redis, scenarioId, playerA, playerB, outcome, mutableA = true, mutableB = true }) {
  const ratingA = await getEloFor(redis, playerA, scenarioId);
  const ratingB = await getEloFor(redis, playerB, scenarioId);
  const duelsA = await getDuelsFor(redis, playerA, scenarioId);
  const duelsB = await getDuelsFor(redis, playerB, scenarioId);

  const scoreA = outcome === "A_wins" ? 1 : outcome === "tie" ? 0.5 : 0;
  const scoreB = 1 - scoreA;

  const expectedA = expectedScore(ratingA, ratingB);
  const expectedB = 1 - expectedA;

  // K=0 for non-mutable sides AND for baseline (defense in depth). A side that
  // is fixed by configuration shouldn't move regardless of caller intent.
  const kA = !mutableA || playerA === BASELINE_NAME ? 0 : kFactor(duelsA);
  const kB = !mutableB || playerB === BASELINE_NAME ? 0 : kFactor(duelsB);

  const newA = ratingA + kA * (scoreA - expectedA);
  const newB = ratingB + kB * (scoreB - expectedB);

  // Persist only for mutable, non-baseline sides. Duel counter bumps for
  // mutable sides too — "how many times you were rated" is a meaningful count,
  // including ties with delta=0.
  if (redis) {
    if (mutableA && playerA !== BASELINE_NAME) {
      await redis.hset(`elo:${playerA.toLowerCase()}`, { [scenarioId]: newA });
      await redis.hincrby(`duels:${playerA.toLowerCase()}`, scenarioId, 1);
    }
    if (mutableB && playerB !== BASELINE_NAME) {
      await redis.hset(`elo:${playerB.toLowerCase()}`, { [scenarioId]: newB });
      await redis.hincrby(`duels:${playerB.toLowerCase()}`, scenarioId, 1);
    }
    if (mutableA && playerA !== BASELINE_NAME) await recomputeCombined(redis, playerA);
    if (mutableB && playerB !== BASELINE_NAME) await recomputeCombined(redis, playerB);
  }

  return {
    [playerA]: { before: ratingA, after: newA, delta: newA - ratingA },
    [playerB]: { before: ratingB, after: newB, delta: newB - ratingB }
  };
}

async function recomputeCombined(redis, player) {
  const all = await redis.hgetall(`elo:${player.toLowerCase()}`);
  if (!all) return;
  const ratings = Object.entries(all)
    .filter(([k]) => k !== "overall")
    .map(([, v]) => Number(v))
    .filter((n) => Number.isFinite(n));
  if (!ratings.length) return;
  const overall = ratings.reduce((a, b) => a + b, 0) / ratings.length;
  await redis.hset(`elo:${player.toLowerCase()}`, { overall });
}

export async function getLeaderboard(redis, scenarioId) {
  // Returns sorted list of { player, rating, duels } for the given scenario.
  // Includes baseline. Players who haven't dueled in this scenario don't appear.
  if (!redis) return [{ player: BASELINE_NAME, rating: SEED_ELO, duels: 0 }];
  const players = await listPlayers();
  const rows = await Promise.all(
    players.map(async (p) => {
      const rating = await getEloFor(redis, p.name, scenarioId);
      const duels = await getDuelsFor(redis, p.name, scenarioId);
      return { player: p.name, rating, duels };
    })
  );
  const playerRows = rows.filter((r) => r.duels > 0);
  return [...playerRows, { player: BASELINE_NAME, rating: SEED_ELO, duels: 0 }].sort(
    (a, b) => b.rating - a.rating
  );
}

export async function getOverallLeaderboard(redis) {
  if (!redis) return [{ player: BASELINE_NAME, rating: SEED_ELO }];
  const players = await listPlayers();
  const rows = await Promise.all(
    players.map(async (p) => {
      const all = (await redis.hgetall(`elo:${p.name.toLowerCase()}`)) || {};
      const overall = Number(all.overall);
      const duels = Object.entries(all)
        .filter(([k]) => k !== "overall")
        .length;
      return {
        player: p.name,
        rating: Number.isFinite(overall) ? overall : SEED_ELO,
        scenariosPlayed: duels
      };
    })
  );
  return [...rows.filter((r) => r.scenariosPlayed > 0), { player: BASELINE_NAME, rating: SEED_ELO, scenariosPlayed: 3 }].sort(
    (a, b) => b.rating - a.rating
  );
}

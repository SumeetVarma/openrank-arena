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
  return Number.isFinite(Number(rating)) ? Number(rating) : SEED_ELO;
}

export async function getDuelsFor(redis, player, scenarioId) {
  if (player === BASELINE_NAME) return Infinity; // baseline is fully established
  if (!redis) return 0;
  const key = `duels:${String(player).toLowerCase()}`;
  const count = await redis.hget(key, scenarioId);
  return Number.isFinite(Number(count)) ? Number(count) : 0;
}

export function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export function kFactor(duelsCount) {
  return duelsCount < PROVISIONAL_DUELS ? PROVISIONAL_K : ESTABLISHED_K;
}

// Apply a duel result. Returns the new ratings + deltas.
//   outcome: "A_wins" | "B_wins" | "tie"
export async function applyDuel({ redis, scenarioId, playerA, playerB, outcome }) {
  const ratingA = await getEloFor(redis, playerA, scenarioId);
  const ratingB = await getEloFor(redis, playerB, scenarioId);
  const duelsA = await getDuelsFor(redis, playerA, scenarioId);
  const duelsB = await getDuelsFor(redis, playerB, scenarioId);

  const scoreA = outcome === "A_wins" ? 1 : outcome === "tie" ? 0.5 : 0;
  const scoreB = 1 - scoreA;

  const expectedA = expectedScore(ratingA, ratingB);
  const expectedB = 1 - expectedA;

  const kA = playerA === BASELINE_NAME ? 0 : kFactor(duelsA);
  const kB = playerB === BASELINE_NAME ? 0 : kFactor(duelsB);

  const newA = ratingA + kA * (scoreA - expectedA);
  const newB = ratingB + kB * (scoreB - expectedB);

  // Persist (baseline stays fixed at SEED_ELO)
  if (redis) {
    if (playerA !== BASELINE_NAME) {
      await redis.hset(`elo:${playerA.toLowerCase()}`, { [scenarioId]: newA });
      await redis.hincrby(`duels:${playerA.toLowerCase()}`, scenarioId, 1);
    }
    if (playerB !== BASELINE_NAME) {
      await redis.hset(`elo:${playerB.toLowerCase()}`, { [scenarioId]: newB });
      await redis.hincrby(`duels:${playerB.toLowerCase()}`, scenarioId, 1);
    }
    // Recompute combined Elo for each non-baseline player (average across scenarios played)
    if (playerA !== BASELINE_NAME) await recomputeCombined(redis, playerA);
    if (playerB !== BASELINE_NAME) await recomputeCombined(redis, playerB);
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

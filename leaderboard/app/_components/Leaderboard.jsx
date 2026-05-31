"use client";

import { useState, useMemo } from "react";

// Single sortable leaderboard table. Columns: Player + Overall + one per scenario.
// Default sort = Overall desc. Click any header to re-sort. Baseline row pinned
// last unless explicitly sorted.

const BASELINE = "baseline";

export default function Leaderboard({ rows, scenarios }) {
  // rows shape: [{ player, overall, perScenario: { carryon: 1042, ... }, duels: { carryon: 4, ... } }]
  const [sortKey, setSortKey] = useState("overall");
  const [sortDir, setSortDir] = useState("desc");

  const sorted = useMemo(() => {
    const valOf = (row) => {
      if (sortKey === "player") return row.player;
      if (sortKey === "overall") return row.overall;
      return row.perScenario[sortKey] ?? 0;
    };
    const arr = [...rows];
    arr.sort((a, b) => {
      // Always pin baseline last unless explicitly clicking the player header
      if (a.player === BASELINE && b.player !== BASELINE) return 1;
      if (b.player === BASELINE && a.player !== BASELINE) return -1;
      const av = valOf(a);
      const bv = valOf(b);
      if (typeof av === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return arr;
  }, [rows, sortKey, sortDir, scenarios]);

  function clickHeader(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function Caret({ active, dir }) {
    if (!active) return <span className="lbCaret" aria-hidden>—</span>;
    return <span className="lbCaret lbCaret--on" aria-hidden>{dir === "desc" ? "▼" : "▲"}</span>;
  }

  return (
    <div className="lbWrap">
      <table className="lbTable">
        <thead>
          <tr>
            <th
              className={`lbHead ${sortKey === "player" ? "is-sorted" : ""}`}
              onClick={() => clickHeader("player")}
            >
              Player <Caret active={sortKey === "player"} dir={sortDir} />
            </th>
            <th
              className={`lbHead lbHead--num ${sortKey === "overall" ? "is-sorted" : ""}`}
              onClick={() => clickHeader("overall")}
            >
              Overall <Caret active={sortKey === "overall"} dir={sortDir} />
            </th>
            {scenarios.map((s) => (
              <th
                key={s.id}
                className={`lbHead lbHead--num ${sortKey === s.id ? "is-sorted" : ""}`}
                onClick={() => clickHeader(s.id)}
                title={s.label}
              >
                {s.shortLabel} <Caret active={sortKey === s.id} dir={sortDir} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => {
            const isBaseline = row.player === BASELINE;
            const rank = i + 1;
            return (
              <tr key={row.player} className={isBaseline ? "lbRow is-baseline" : "lbRow"}>
                <td className="lbCell lbCell--name">
                  <span className="lbRank">{String(rank).padStart(2, "0")}</span>
                  {isBaseline ? (
                    <span className="lbName">baseline</span>
                  ) : (
                    <a className="lbName" href={`/players/${row.player}`}>{row.player}</a>
                  )}
                </td>
                <td className="lbCell lbCell--num">{Math.round(row.overall)}</td>
                {scenarios.map((s) => {
                  const v = row.perScenario[s.id];
                  const d = row.duels?.[s.id] ?? 0;
                  return (
                    <td key={s.id} className={`lbCell lbCell--num ${d === 0 && !isBaseline ? "lbCell--unranked" : ""}`}>
                      {v != null ? Math.round(v) : "—"}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {sorted.length === 0 && (
            <tr>
              <td className="lbCell" colSpan={2 + scenarios.length} style={{ textAlign: "center", padding: 32, color: "var(--ink-mute)", fontStyle: "italic" }}>
                No players yet. First submission claims a name and lights up the board.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

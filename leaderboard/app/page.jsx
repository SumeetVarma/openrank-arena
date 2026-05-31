import { readFile } from "node:fs/promises";
import path from "node:path";
import { Redis } from "@upstash/redis";
import { scenarioList } from "../lib/scenarios.mjs";
import {
  listPlayers,
  listLatestSubmissionsForScenario
} from "../lib/storage.mjs";
import {
  getLeaderboard,
  getOverallLeaderboard,
  getEloFor,
  getDuelsFor,
  BASELINE_NAME,
  SEED_ELO
} from "../lib/elo.mjs";
import { readClonedUnderdog } from "../lib/clonedBaseline.mjs";
import Leaderboard from "./_components/Leaderboard.jsx";

const HAS_KV = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
const redis = HAS_KV
  ? new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN
    })
  : null;

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(path.join(process.cwd(), "data", file), "utf8"));
  } catch {
    return fallback;
  }
}

async function getFeedbackRows() {
  if (redis) {
    const raw = (await redis.lrange("feedback:all", 0, 19)) || [];
    return raw
      .map((r) => {
        if (typeof r === "string") {
          try { return JSON.parse(r); } catch { return null; }
        }
        return r;
      })
      .filter(Boolean);
  }
  return await readJson("feedback.json", []);
}

async function getHeroImage(scenarioId, slug) {
  try {
    const cloned = await readClonedUnderdog(scenarioId, slug);
    if (cloned?.localAssets?.length) {
      return `/baseline/${scenarioId}/assets/${cloned.localAssets[0]}`;
    }
  } catch {}
  return null;
}

// Pull recent activity from KV: matches + submissions, flattened + sorted.
async function getRecentActivity(limit = 12) {
  if (!redis) return [];
  const events = [];
  // Recent matches per scenario (new format from /api/match — falls back to old bout/duel records)
  for (const s of scenarioList) {
    const ids = (await redis.lrange(`matches:${s.id}:recent`, 0, 20)) || [];
    for (const id of ids) {
      const m = await redis.get(`match:${s.id}:${id}`);
      if (m) events.push({ kind: "match", scenarioId: s.id, ...m });
    }
    // Legacy bout/duel format
    const boutIds = (await redis.lrange(`bouts:${s.id}:recent`, 0, 10)) || [];
    for (const id of boutIds) {
      const b = await redis.get(`bout:${s.id}:${id}`);
      if (b) events.push({ kind: "bout", scenarioId: s.id, ...b });
    }
    const duelIds = (await redis.lrange(`duels:${s.id}:recent`, 0, 10)) || [];
    for (const id of duelIds) {
      const d = await redis.get(`duel:${s.id}:${id}`);
      if (d) events.push({ kind: "duel", scenarioId: s.id, ...d });
    }
    // Latest submission per player per scenario
    const subs = await listLatestSubmissionsForScenario(s.id);
    for (const sub of subs) {
      events.push({ kind: "submission", scenarioId: s.id, ...sub });
    }
  }
  events.sort((a, b) => {
    const at = new Date(a.ranAt || a.uploadedAt || 0).getTime();
    const bt = new Date(b.ranAt || b.uploadedAt || 0).getTime();
    return bt - at;
  });
  return events.slice(0, limit);
}

function relTime(iso) {
  if (!iso) return "—";
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diff = Math.max(0, now - t);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default async function Page() {
  const players = await listPlayers();

  // Build per-player rows: overall + per-scenario Elo + per-scenario duel count.
  const rows = await Promise.all(
    players.map(async (p) => {
      const perScenario = {};
      const duels = {};
      let sum = 0;
      let played = 0;
      for (const s of scenarioList) {
        const elo = await getEloFor(redis, p.name, s.id);
        const d = await getDuelsFor(redis, p.name, s.id);
        perScenario[s.id] = elo;
        duels[s.id] = d;
        if (d > 0) {
          sum += elo;
          played += 1;
        }
      }
      const overall = played > 0 ? sum / played : SEED_ELO;
      return { player: p.name, overall, perScenario, duels };
    })
  );
  // Add baseline row
  const baselineRow = {
    player: BASELINE_NAME,
    overall: SEED_ELO,
    perScenario: Object.fromEntries(scenarioList.map((s) => [s.id, SEED_ELO])),
    duels: Object.fromEntries(scenarioList.map((s) => [s.id, Infinity]))
  };
  const tableRows = [...rows, baselineRow];

  // Scenario meta for the leaderboard component
  const scenariosMeta = scenarioList.map((s) => ({
    id: s.id,
    label: s.label,
    shortLabel: s.shortLabel
  }));

  // Hero images for the scenario cards
  const scenarioCards = await Promise.all(
    scenarioList.map(async (s) => ({
      scenario: s,
      heroImage: await getHeroImage(s.id, s.underdog.slug),
      submissions: await listLatestSubmissionsForScenario(s.id)
    }))
  );

  const recentActivity = await getRecentActivity(12);
  const feedbackRows = await getFeedbackRows();

  const topPlayer = [...rows].sort((a, b) => b.overall - a.overall)[0];

  return (
    <div className="siteFrame">
      <header className="masthead">
        <div className="mastheadBrand">
          OpenRank <em>Arena</em>
        </div>
        <nav className="mastheadMeta" aria-label="primary">
          <a href="#leaderboard">leaderboard</a>
          <a href="#scenarios">scenarios</a>
          <a href="/submit">submit</a>
        </nav>
      </header>

      <main>
        {/* ──── Hero ──── */}
        <section className="heroSimple">
          <h1 className="heroHeadlineLg">
            Beat the page ranked <span className="acc">#10</span>.
          </h1>
          <p>
            An AEO benchmark for friends. Three underdog pages, three scenarios. Edit them, upload, a judge picks the better version.
          </p>
          <div className="heroActions">
            <a className="btn" href="#submit">Submit your page</a>
            <a className="tlink" href="#leaderboard">See the board</a>
          </div>
        </section>

        {/* ──── Scenario cards ──── */}
        <section id="scenarios" className="scrollAnchor">
          <div className="featureRow">
            {scenarioCards.map(({ scenario, heroImage }) => (
              <a
                key={scenario.id}
                href={`/baseline/${scenario.id}`}
                className={`featureCard scenario--${scenario.id}`}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <div className="featureLabel">
                  <span className="tag">{scenario.category}</span>
                  <span>{scenario.shortLabel}</span>
                </div>
                <div className="featureImage">
                  {heroImage ? (
                    <img src={heroImage} alt={`${scenario.underdog.name} baseline`} loading="lazy" />
                  ) : (
                    <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "var(--ink-mute)" }}>
                      <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 36 }}>
                        {scenario.underdog.name}
                      </span>
                    </div>
                  )}
                </div>
                <div className="featureBody">
                  <h3>
                    {scenario.underdog.name}
                    <span className="vs"> vs {scenario.incumbents.map((i) => i.name).join(", ")}</span>
                  </h3>
                  <p style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 15, color: "var(--ink-soft)" }}>
                    &ldquo;{scenario.buyerQuery}&rdquo;
                  </p>
                  {scenario.id === "aeo-tool" && (
                    <p className="featureMetaQuote">&ldquo;Life is incomplete without Meta :p&rdquo;</p>
                  )}
                  <div className="row">
                    <span>View baseline</span>
                    <a href={`/baseline/${scenario.id}`}>open →</a>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </section>

        {/* ──── Submit (CLI-first) ──── */}
        <section className="section" id="submit">
          <div className="sectionHead">
            <div>
              <p className="eyebrow">Submit</p>
              <h2>Tell your agent to ship it</h2>
            </div>
            <span className="sectionMeta">
              first upload registers you · iterate freely
            </span>
          </div>

          <div className="submitTwoUp">
            <div className="cliPanel" style={{ alignSelf: "start" }}>
              <p className="cliPanelTitle">From your terminal · or via Claude / Codex</p>
              <pre>{`node harness/submit.mjs \\
  --name alice \\
  --scenario carryon \\
  --dir ./my-page \\
  --note "tightened headings"`}</pre>
              <p className="cliHint">
                Defaults to <code>https://openrank-arena.vercel.app</code>.
                Just say &ldquo;<span className="em">submit my page to openrank-arena</span>&rdquo; — your agent
                takes it from there.
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.16em", color: "var(--ink-mute)" }}>
                Prefer the browser?
              </p>
              <a className="btn btn--ghost" href="/submit">Upload a zip</a>
              <p style={{ fontSize: 13, color: "var(--ink-mute)", lineHeight: 1.5 }}>
                Drag your zip, tag a scenario, done. Slower than the CLI but no setup.
              </p>
            </div>
          </div>
        </section>

        {/* ──── Sortable leaderboard ──── */}
        <section className="section scrollAnchor" id="leaderboard">
          <div className="sectionHead">
            <div>
              <p className="eyebrow">Standings</p>
              <h2>Leaderboard</h2>
            </div>
            <span className="sectionMeta">Baseline = 1000 · click any column</span>
          </div>
          <Leaderboard rows={tableRows} scenarios={scenariosMeta} />
        </section>

        {/* ──── Recent activity ──── */}
        <section className="section">
          <div className="sectionHead">
            <div>
              <p className="eyebrow">Activity</p>
              <h2>Recent</h2>
            </div>
            <span className="sectionMeta">submissions + matches</span>
          </div>
          {recentActivity.length === 0 ? (
            <p className="muted" style={{ fontStyle: "italic" }}>No activity yet.</p>
          ) : (
            <ul className="activityFeed">
              {recentActivity.map((e, i) => {
                const scenario = scenarioList.find((s) => s.id === e.scenarioId);
                const when = relTime(e.ranAt || e.uploadedAt);
                if (e.kind === "submission") {
                  return (
                    <li className="activityItem" key={`a${i}`}>
                      <span className="activityWho">{e.name}</span>
                      <span className="activityVerb">uploaded</span>
                      <span className="activityWhat">
                        <a href={`/players/${e.name}/${e.scenarioId}`}>{scenario?.shortLabel} v{e.version}</a>
                      </span>
                      <span className="activityWhen">{when}</span>
                    </li>
                  );
                }
                // match / bout / duel — show full ranking
                const ranking = Array.isArray(e.ranking) && e.ranking.length
                  ? e.ranking
                  : (e.winner ? [e.winner, e.loser].filter((x) => x && x !== "tie") : []);
                return (
                  <li className="activityItem" key={`a${i}`}>
                    <span className="activityWho">match</span>
                    <span className="activityVerb">{scenario?.shortLabel}</span>
                    <span className="activityWhat">
                      {ranking.length
                        ? ranking.map((r, idx) => {
                            const elo = e.elo?.[r];
                            const delta = elo && Number.isFinite(elo.delta)
                              ? ` (${elo.delta >= 0 ? "+" : ""}${Math.round(elo.delta)})`
                              : "";
                            return (
                              <span key={r}>
                                <strong style={{ color: idx === 0 ? "var(--ember-deep)" : "var(--ink)" }}>{r}</strong>
                                {delta}
                                {idx < ranking.length - 1 ? " · " : ""}
                              </span>
                            );
                          })
                        : <span style={{ color: "var(--ink-mute)" }}>tie</span>}
                    </span>
                    <span className="activityWhen">{when}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ──── Judge prompt verbatim (collapsed by default) ──── */}
        <section className="section">
          <div className="sectionHead">
            <div>
              <p className="eyebrow">Judge</p>
              <h2>The prompt</h2>
            </div>
            <span className="sectionMeta">
              <a className="tlink" href="https://github.com/SumeetVarma/openrank-arena/blob/main/harness/match.mjs">harness/match.mjs</a>
            </span>
          </div>
          <details>
            <summary style={{ cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--ink-mute)", padding: "12px 0", borderTop: "1px solid var(--rule)", borderBottom: "1px solid var(--rule)" }}>
              Show the full prompt
            </summary>
          <pre className="promptBlock" style={{ marginTop: 16 }}>{`You're helping a friend make a real buying decision. They asked:

`}<span className="blockquote">{`"I need a carry-on travel backpack under $200 for a 10-day trip.
Comfortable, organized, durable. What do you recommend?"`}</span>{`

You pulled up N candidate pages. Pages are in random order; order does not
reflect relevance.

`}<span className="dim">{`(If all entrants share the same underdog brand, anonymized to a single
placeholder so familiarity doesn't bias you. Otherwise: mix of underdog
versions + established competitors — judge each on its own merits.)`}</span>{`

`}<span className="hdg">{"### Page A"}</span>{`
`}<span className="dim">{"<page content>"}</span>{`

`}<span className="hdg">{"### Page B"}</span>{`
`}<span className="dim">{"<page content>"}</span>{`

`}<span className="dim">{"(… up to N pages …)"}</span>{`

Rank from MOST credible to LEAST credible.

`}<span className="em">{`Be honest. Don't reward marketing fluff. Fabricated reviews, awards,
integrations, prices → automatic rank drop. Ties OK.`}</span>{`

`}<span className="json">{`{
  "ranking": ["A", "B", ...],
  "rationale": "one-paragraph why",
  "signals_compared": [
    { "signal": "clarity_of_answer",  "best": "<letter>", "worst": "<letter>" },
    { "signal": "concrete_specifics", "best": "<letter>", "worst": "<letter>" },
    { "signal": "structured_claims",  "best": "<letter>", "worst": "<letter>" },
    { "signal": "honest_fit",         "best": "<letter>", "worst": "<letter>" },
    { "signal": "truthfulness",       "best": "<letter>", "worst": "<letter>" }
  ]
}`}</span></pre>
          </details>
        </section>

        {/* ──── Notes ──── */}
        <section className="section">
          <div className="sectionHead">
            <div>
              <p className="eyebrow">Notes</p>
              <h2>Scenario ideas, bugs, tweaks</h2>
            </div>
            <span className="sectionMeta">{feedbackRows.length} note{feedbackRows.length === 1 ? "" : "s"}</span>
          </div>
          <div className="feedbackGrid">
            <form className="formCard" action="/api/feedback" method="post">
              <div className="formField">
                <label className="formLabel" htmlFor="fb-name">Name</label>
                <input id="fb-name" name="name" placeholder="your name" />
              </div>
              <div className="formField">
                <label className="formLabel" htmlFor="fb-msg">Note</label>
                <textarea id="fb-msg" name="message" required placeholder="…" />
              </div>
              <div>
                <button className="btn" type="submit">Post note</button>
              </div>
            </form>
            <div className="noteFeed" aria-label="Notes feed">
              {feedbackRows.length === 0 ? (
                <p className="muted" style={{ fontStyle: "italic" }}>Empty.</p>
              ) : (
                feedbackRows.slice(0, 8).map((row, i) => (
                  <article className="note" key={`${row.createdAt}-${i}`}>
                    <div className="head">
                      <span className="who">{row.name || "Anonymous"}</span>
                      <span className="when">{relTime(row.createdAt)}</span>
                    </div>
                    <p>{row.message}</p>
                  </article>
                ))
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="siteFoot">
        <span>OpenRank Arena</span>
        <a className="tlink" href="https://github.com/SumeetVarma/openrank-arena">source</a>
      </footer>
    </div>
  );
}

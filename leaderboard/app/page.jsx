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
  const totalMatches = recentActivity.filter((e) => e.kind !== "submission").length;

  return (
    <div className="siteFrame">
      <header className="masthead">
        <div className="mastheadBrand">
          OpenRank <em>Arena</em>
        </div>
        <nav className="mastheadMeta" aria-label="primary">
          <a href="#scenarios">Scenarios</a>
          <a href="#leaderboard">Leaderboard</a>
          <a href="#how">How it works</a>
          <a className="btn btn--sm" href="#submit" style={{ marginLeft: 8 }}>Submit</a>
        </nav>
      </header>
      <p className="tagline">Anonymous AEO duels · Real results</p>

      <main>
        {/* ──── Hero + stats card ──── */}
        <section className="heroSplit">
          <div className="heroSplitMain">
            <h1 className="heroHeadlineLg">
              Beat the page<br />
              ranked <span className="acc">#10</span>.
            </h1>
            <p className="heroSplitLede">
              Take an underdog page. Rewrite it. Submit head-to-head against your friends. A blind judge picks the better version.
            </p>
            <div className="heroActions" style={{ marginTop: "var(--s-5)" }}>
              <a className="btn" href="#submit">Submit your page</a>
              <a className="tlink" href="#scenarios">See the scenarios</a>
            </div>
          </div>

          <aside className="statBoard" aria-label="Arena stats">
            <p className="statBoardTitle">Arena at a glance</p>
            <dl className="statBoardList">
              <div className="statRow">
                <dt>
                  <span className="statIcon" aria-hidden>
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="9" cy="8" r="3.5" />
                      <path d="M16 11a2.5 2.5 0 100-5" />
                      <path d="M3 19c0-3 2.5-5 6-5s6 2 6 5" />
                      <path d="M16 14c2.5 0 5 1.5 5 5" />
                    </svg>
                  </span>
                  <span>Active players</span>
                </dt>
                <dd className="tnum">{String(players.length).padStart(2, "0")}</dd>
              </div>
              <div className="statRow">
                <dt>
                  <span className="statIcon" aria-hidden>
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
                    </svg>
                  </span>
                  <span>Duels run</span>
                </dt>
                <dd className="tnum">{String(totalMatches).padStart(2, "0")}</dd>
              </div>
              <div className="statRow">
                <dt>
                  <span className="statIcon" aria-hidden>
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M7 4h10v3a5 5 0 11-10 0V4z" />
                      <path d="M5 4h2v3a3 3 0 11-3 0V4z" transform="translate(2,0)" />
                      <path d="M9 16h6v2H9z" />
                      <path d="M8 18h8v2H8z" />
                    </svg>
                  </span>
                  <span>Top of board</span>
                </dt>
                <dd className={topPlayer ? "leader" : "empty"} style={{ fontFamily: "var(--font-display)", fontStyle: topPlayer ? "italic" : "normal" }}>
                  {topPlayer ? topPlayer.player : "no one yet"}
                </dd>
              </div>
            </dl>
          </aside>
        </section>

        {/* ──── Scenario cards ──── */}
        <section id="scenarios" className="scrollAnchor">
          <div className="featureRow">
            {scenarioCards.map(({ scenario, heroImage }) => {
              // For AEO tool, the cloned hero image is a busted text-screenshot fragment.
              // Use the illustrated empty state instead so the card actually looks like a real product.
              const useImg = heroImage && scenario.id !== "aeo-tool";
              return (
              <a
                key={scenario.id}
                href={`/baseline/${scenario.id}`}
                className={`featureCard scenario--${scenario.id}`}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <div className="featureLabel">
                  <span>{scenario.shortLabel}</span>
                  <span className="tag">view →</span>
                </div>
                <div className="featureImage">
                  {useImg ? (
                    <img src={heroImage} alt={`${scenario.underdog.name} baseline`} loading="lazy" />
                  ) : (
                    <div style={{
                      width: "100%",
                      height: "100%",
                      display: "grid",
                      placeItems: "center",
                      background: scenario.id === "aeo-tool"
                        ? "linear-gradient(135deg, var(--plum) 0%, #2a1f28 100%)"
                        : "var(--paper-deep)",
                      color: scenario.id === "aeo-tool" ? "var(--paper-light)" : "var(--ink-mute)"
                    }}>
                      <span style={{
                        fontFamily: "var(--font-display)",
                        fontStyle: "italic",
                        fontSize: 48,
                        fontVariationSettings: "'opsz' 144, 'SOFT' 100, 'WONK' 1"
                      }}>
                        {scenario.underdog.name}
                      </span>
                    </div>
                  )}
                </div>
                <div className="featureBody">
                  <h3>
                    {scenario.underdog.name}
                  </h3>
                  <p style={{ fontSize: 13, color: "var(--ink-mute)", margin: "2px 0 8px" }}>
                    vs {scenario.incumbents.map((i) => i.name).join(", ")}
                  </p>
                  <p style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 14, color: "var(--ink-soft)", lineHeight: 1.4 }}>
                    Buyer asks: &ldquo;{scenario.buyerQuery.length > 110 ? scenario.buyerQuery.slice(0, 110) + "…" : scenario.buyerQuery}&rdquo;
                  </p>
                  {scenario.id === "aeo-tool" && (
                    <p className="featureMetaQuote">&ldquo;Life is incomplete without Meta :p&rdquo;</p>
                  )}
                </div>
              </a>
              );
            })}
          </div>
        </section>

        {/* ──── Submit (CLI-first) ──── */}
        <section className="section" id="submit">
          <div className="sectionHead">
            <div>
              <p className="eyebrow">Submit</p>
              <h2>Tell your agent to ship it</h2>
            </div>
          </div>

          <div className="submitThreeUp">
            <div className="zipPanel">
              <p className="zipPanelTitle">What goes in the zip</p>
              <ul className="zipList">
                <li>
                  <code>index.html</code>
                  <span className="req">required</span>
                  <p>The visible page. Real semantic HTML — headings, copy, JSON-LD inline, meta in &lt;head&gt;.</p>
                </li>
                <li>
                  <code>llms.txt</code>
                  <span className="rec">recommended</span>
                  <p>Plain-text summary for AI crawlers. Served at the page&apos;s URL + /llms.txt.</p>
                </li>
                <li>
                  <code>assets/</code>
                  <span className="rec">recommended</span>
                  <p>Images and any other static files. Reference as <code>assets/foo.jpg</code> in your HTML.</p>
                </li>
                <li>
                  <code>robots.txt</code>
                  <span className="opt">optional</span>
                  <p>Per-page crawler control. Defaults to permissive otherwise.</p>
                </li>
              </ul>
            </div>

            <div className="cliPanel" style={{ alignSelf: "start" }}>
              <p className="cliPanelTitle">Clone the repo, then ship from your terminal</p>
              <pre>{`git clone https://github.com/SumeetVarma/openrank-arena
cd openrank-arena

node harness/submit.mjs \\
  --name alice \\
  --scenario carryon \\
  --dir ./my-page \\
  --note "tightened headings"`}</pre>
              <p className="cliHint">
                Or just say &ldquo;<span className="em">submit my page to openrank-arena</span>&rdquo;
                to <span className="em">Claude / Codex / Cursor</span> — your agent clones the repo
                and runs it for you.
              </p>
              <p className="cliHint" style={{ marginTop: 12 }}>
                Prefer the browser? <a className="tlink" href="/submit" style={{ color: "var(--ember-soft)", borderColor: "var(--ember-soft)" }}>Upload a zip →</a>
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

      <div className="climbBar">
        <strong>Was incognito. Climb the leaderboard.</strong>
        <a className="climbCta" href="#submit">
          Climb the leaderboard ↗
        </a>
      </div>

      <footer className="siteFoot">
        <span>OpenRank Arena</span>
        <a className="tlink" href="https://github.com/SumeetVarma/openrank-arena">source</a>
      </footer>
    </div>
  );
}

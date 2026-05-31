import { readFile } from "node:fs/promises";
import path from "node:path";
import { Redis } from "@upstash/redis";
import { scenarioList } from "../lib/scenarios.mjs";
import {
  listPlayers,
  listLatestSubmissionsForScenario,
  getRecentScores
} from "../lib/storage.mjs";
import {
  getLeaderboard,
  getOverallLeaderboard,
  BASELINE_NAME
} from "../lib/elo.mjs";
import { readClonedUnderdog } from "../lib/clonedBaseline.mjs";

const HAS_KV = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
const redis = HAS_KV
  ? new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN
    })
  : null;

const SCENARIO_TAG = {
  carryon: "Consumer goods · Round 01",
  dental: "Local service · Round 02",
  "aeo-tool": "B2B SaaS · Round 03"
};

// Short feature copy per scenario — punchy not literary
const SCENARIO_FEATURE = {
  carryon: {
    headline: "Wayfare 42",
    versus: "vs Voyager Pro 40, Roamcore",
    blurb:
      "A real ~#10 travel pack. Brand swapped, copy intact. Beat two carry-on heavyweights at one buyer's value query."
  },
  dental: {
    headline: "Maple Street Dental",
    versus: "vs Cedar Hill, Parmer Lane",
    blurb:
      "A small Austin family practice. Soft hours, warmer copy, less polish. Out-rank two established neighborhood incumbents."
  },
  "aeo-tool": {
    headline: "OpenRank",
    versus: "vs Lumen AEO, Vantage AI",
    blurb:
      "The meta-scenario: a young AEO startup competing with two established AEO/SEO platforms for one buyer's tool query.",
    meta: "Life is incomplete without Meta :p"
  }
};

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(path.join(process.cwd(), "data", file), "utf8"));
  } catch {
    return fallback;
  }
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

export default async function Page() {
  const players = await listPlayers();
  const overallEloBoard = await getOverallLeaderboard(redis);

  const scenarioCards = await Promise.all(
    scenarioList.map(async (s) => {
      const submissions = await listLatestSubmissionsForScenario(s.id);
      const scores = await getRecentScores(s.id, 6);
      const eloBoard = await getLeaderboard(redis, s.id);
      const heroImage = await getHeroImage(s.id, s.underdog.slug);
      return { scenario: s, submissions, scores, eloBoard, heroImage };
    })
  );

  const feedback = await readJson("feedback.json", []);
  const feedbackRows = [...feedback].sort(
    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  );

  const totalDuels = scenarioCards.reduce((acc, b) => acc + b.scores.length, 0);
  const topPlayer = overallEloBoard.find((r) => r.player !== BASELINE_NAME);

  // Compose a "top players" list across all scenarios (for the warm card).
  // Use overall Elo if any duels exist, else show baseline + signed-up players.
  const topRows = (() => {
    const ranked = overallEloBoard.filter((r) => r.player !== BASELINE_NAME);
    if (ranked.length) {
      return [
        ...ranked.slice(0, 5),
        { player: BASELINE_NAME, rating: 1000, scenariosPlayed: 3 }
      ];
    }
    // No one has dueled yet — show the joined players seeded at 1000
    return [
      ...players.slice(0, 5).map((p) => ({ player: p.name, rating: 1000, scenariosPlayed: 0 })),
      { player: BASELINE_NAME, rating: 1000, scenariosPlayed: 3 }
    ];
  })();

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
          <label className="searchPill">
            <span aria-hidden>⌕</span>
            <input type="search" placeholder="search players, scenarios" aria-label="Search" />
            <span className="kbd">/</span>
          </label>
        </nav>
      </header>

      <main>
        {/* ──── HERO + warm leaderboard card ──── */}
        <section className="heroV2">
          <div>
            <p className="heroRibbon">Vol. 01 · An AEO dojo for friends</p>
            <h1 className="heroHeadlineLg">
              Take a page<br />
              buried at <span style={{ position: "relative", display: "inline-block" }}>
                <span style={{ position: "relative" }}>
                  #10<span style={{
                    position: "absolute",
                    left: "-2%",
                    right: "-2%",
                    top: "58%",
                    height: 4,
                    background: "var(--ember)",
                    transformOrigin: "left center",
                    animation: "drawStrike 800ms cubic-bezier(0.65, 0, 0.35, 1) 400ms both"
                  }} />
                </span>
              </span>.<br />
              Drag it <span className="acc">uphill</span>.
            </h1>
            <p>
              Three underdog pages. Three categories. Rewrite, restructure, tune the schema. Upload your version. The judge picks the more credible one of every pair. Elo updates. Climb.
            </p>
            <div className="heroActions">
              <a className="btn" href="/submit">Submit your page</a>
              <a className="tlink" href="#scenarios">Explore scenarios</a>
            </div>
          </div>

          <aside className="boardCard" aria-label="Leaderboard summary">
            <dl className="boardCardHead" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div className="boardStat">
                <dt>Players</dt>
                <dd className="tnum">
                  {String(players.length).padStart(2, "0")}
                </dd>
              </div>
              <div className="boardStat">
                <dt>Current leader</dt>
                <dd className={topPlayer ? "leader" : "empty"}>
                  {topPlayer ? topPlayer.player : "nobody yet"}
                </dd>
              </div>
            </dl>

            <div className="boardCardBody">
              <div className="boardCardTitle">
                <h3>Top players</h3>
                <a href="#leaderboard">View full leaderboard →</a>
              </div>
              {topRows.length === 0 ? (
                <p className="boardCardEmpty">No players yet. Be the first to claim a name.</p>
              ) : (
                <ol className="boardCardList">
                  {topRows.map((r, i) => {
                    const isBaseline = r.player === BASELINE_NAME;
                    const isLeader = i === 0 && !isBaseline && r.rating > 1000;
                    const cls = ["boardCardRow"];
                    if (isBaseline) cls.push("is-baseline");
                    if (isLeader) cls.push("is-leader");
                    return (
                      <li key={r.player} className={cls.join(" ")}>
                        <span className="rank">{String(i + 1).padStart(2, "0")}</span>
                        <span className="name">{isBaseline ? "baseline" : r.player}</span>
                        <span className="ctx">
                          {isBaseline
                            ? "anchor"
                            : r.scenariosPlayed > 0
                              ? `${r.scenariosPlayed} played`
                              : "unranked"}
                        </span>
                        <span className="elo tnum">{Math.round(r.rating)}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </aside>
        </section>

        {/* ──── Featured scenarios row (product hero cards) ──── */}
        <section id="scenarios" className="scrollAnchor">
          <div className="featureRow">
            {scenarioCards.map(({ scenario, heroImage }, idx) => {
              const meta = SCENARIO_FEATURE[scenario.id];
              return (
                <a
                  key={scenario.id}
                  href={`/baseline/${scenario.id}`}
                  className={`featureCard scenario--${scenario.id}`}
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <div className="featureLabel">
                    <span className="tag">Featured scenario</span>
                    <span>{SCENARIO_TAG[scenario.id]}</span>
                  </div>
                  <div className="featureImage">
                    {heroImage ? (
                      <img src={heroImage} alt={`${meta.headline} — featured baseline`} loading="lazy" />
                    ) : (
                      <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "var(--ink-mute)" }}>
                        <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 36 }}>
                          {meta.headline}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="featureBody">
                    <h3>
                      {meta.headline}
                      <span className="vs"> {meta.versus}</span>
                    </h3>
                    <p>{meta.blurb}</p>
                    {meta.meta && <p className="featureMetaQuote">&ldquo;{meta.meta}&rdquo;</p>}
                    <div className="row">
                      <span>View baseline</span>
                      <a href={`/baseline/${scenario.id}`}>open →</a>
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        </section>

        {/* ──── Full leaderboard (dense, anchor) ──── */}
        <section className="section scrollAnchor" id="leaderboard">
          <div className="sectionHead">
            <div>
              <p className="eyebrow">Standings</p>
              <h2>Leaderboard</h2>
            </div>
            <span className="sectionMeta">Baseline = 1000</span>
          </div>

          <div className="boardWrap">
            <div className="boardCol">
              <div className="boardColHead">
                <h3>Overall</h3>
                <span className="count">All scenarios · mean</span>
              </div>
              {overallEloBoard.length === 0 ? (
                <p className="boardEmpty">No duels yet.</p>
              ) : (
                <ol className="boardList">
                  {overallEloBoard.slice(0, 8).map((r, i) => {
                    const isBaseline = r.player === BASELINE_NAME;
                    const isLeader = i === 0 && !isBaseline;
                    const cls = ["boardRow"];
                    if (isBaseline) cls.push("is-baseline");
                    if (isLeader) cls.push("is-leader");
                    return (
                      <li key={r.player} className={cls.join(" ")}>
                        <span className="boardRank">{String(i + 1).padStart(2, "0")}</span>
                        <span className="boardName">
                          {isBaseline ? "baseline" : <a href={`/players/${r.player}`}>{r.player}</a>}
                        </span>
                        <span className="boardElo tnum">{Math.round(r.rating)}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
            {scenarioCards.map(({ scenario, eloBoard }) => (
              <div className="boardCol" key={`board-${scenario.id}`}>
                <div className="boardColHead">
                  <h3>{scenario.label.split(/ in | for /)[0]}</h3>
                  <span className="count">
                    {eloBoard.filter((r) => r.player !== BASELINE_NAME).length} ranked
                  </span>
                </div>
                {eloBoard.length === 0 ? (
                  <p className="boardEmpty">No duels yet.</p>
                ) : (
                  <ol className="boardList">
                    {eloBoard.slice(0, 8).map((r, i) => {
                      const isBaseline = r.player === BASELINE_NAME;
                      const isLeader = i === 0 && !isBaseline;
                      const cls = ["boardRow"];
                      if (isBaseline) cls.push("is-baseline");
                      if (isLeader) cls.push("is-leader");
                      return (
                        <li key={r.player} className={cls.join(" ")}>
                          <span className="boardRank">{String(i + 1).padStart(2, "0")}</span>
                          <span className="boardName">
                            {isBaseline ? "baseline" : <a href={`/players/${r.player}`}>{r.player}</a>}
                          </span>
                          <span className="boardElo tnum">{Math.round(r.rating)}</span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ──── The judge prompt (verbatim) ──── */}
        <section className="section">
          <div className="sectionHead">
            <div>
              <p className="eyebrow">The judge</p>
              <h2>The actual prompt. No marketing copy.</h2>
            </div>
            <span className="sectionMeta">Same prompt every duel · open-source</span>
          </div>
          <pre className="promptBlock">{`You're helping a friend make a real buying decision. They asked:

`}<span className="blockquote">{`"I need a carry-on travel backpack under $200 for a 10-day trip.
Comfortable, organized, durable. What do you recommend?"`}</span>{`

You pulled up the candidate pages an AI answer engine surfaced. Most are
from established competitors in the market. Two of the pages are from the
same lesser-known option — both have been anonymized to the same
placeholder name so the brand name doesn't bias your judgment. They
represent two different versions of that same option's web presence.

Here's the market context — established players in this category:

`}<span className="hdg">{"### Voyager Pro 40"}</span>{`
`}<span className="dim">{"<page content...>"}</span>{`

`}<span className="hdg">{"### Roamcore Travel Pack"}</span>{`
`}<span className="dim">{"<page content...>"}</span>{`

And here are the two versions of the same lesser-known option you've
been asked to compare:

`}<span className="hdg">{"### Page A"}</span>{`
`}<span className="dim">{"<player A's optimized page>"}</span>{`

`}<span className="hdg">{"### Page B"}</span>{`
`}<span className="dim">{"<player B's optimized page>"}</span>{`

Both Page A and Page B describe the same underlying option. Treat them
as two attempts to explain the same thing — your job is to decide which
one would more credibly stand alongside the established competitors
above and earn a recommendation, if your friend was actually deciding
right now.

`}<span className="em">{`Be honest. Don't reward marketing fluff. Don't reward made-up claims
(fake reviews, fake awards, fake integrations, fake prices) — if you
spot fabrication, that page should lose. A tie is fine if both are
genuinely equivalent.`}</span>{`

When you're done, write 3–5 sentences explaining your call, then end
with a JSON object:

`}<span className="json">{`{
  "winner": "A" | "B" | "tie",
  "rationale": "one-paragraph why",
  "signals_compared": [
    { "signal": "clarity_of_answer",   "stronger": "A" | "B" | "tie" },
    { "signal": "structured_claims",   "stronger": "A" | "B" | "tie" },
    { "signal": "first_impression",    "stronger": "A" | "B" | "tie" },
    { "signal": "concrete_specifics",  "stronger": "A" | "B" | "tie" },
    { "signal": "visual_evidence",     "stronger": "A" | "B" | "tie" },
    { "signal": "honest_fit",          "stronger": "A" | "B" | "tie" },
    { "signal": "truthfulness",        "stronger": "A" | "B" | "tie" }
  ]
}`}</span></pre>
          <p style={{ marginTop: 16, fontSize: 13, color: "var(--ink-mute)", fontStyle: "italic" }}>
            That&apos;s it. Same prompt every duel. Same buyer query per scenario. The judge never knows it&apos;s a benchmark.
            Source: <a className="tlink" href="https://github.com/SumeetVarma/openrank-arena/blob/main/harness/duel.mjs">harness/duel.mjs</a>
          </p>
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
                <textarea
                  id="fb-msg"
                  name="message"
                  required
                  placeholder="Scenario ideas, judge prompt tweaks, things that broke…"
                />
              </div>
              <div>
                <button className="btn" type="submit">Post note</button>
              </div>
            </form>
            <div className="noteFeed" aria-label="Notes feed">
              {feedbackRows.length === 0 ? (
                <p className="muted" style={{ fontStyle: "italic" }}>
                  Empty. Drop a scenario idea, a judge tweak, or just say hi.
                </p>
              ) : (
                feedbackRows.slice(0, 8).map((row, i) => (
                  <article className="note" key={`${row.createdAt}-${i}`}>
                    <div className="head">
                      <span className="who">{row.name || "Anonymous"}</span>
                      <span className="when">
                        {row.createdAt
                          ? new Date(row.createdAt).toLocaleString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit"
                            })
                          : "just now"}
                      </span>
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
        <span>OpenRank Arena · An AEO dojo</span>
        <span>
          Built by <em style={{ fontStyle: "italic", color: "var(--ember)" }}>SumeetVarma</em> +
          <a className="tlink" href="https://github.com/SumeetVarma/openrank-arena" style={{ marginLeft: 6 }}>
            source
          </a>
        </span>
      </footer>
    </div>
  );
}

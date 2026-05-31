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
              You&apos;ll be given short product pages from underdog brands. Rewrite the copy.
              Sharpen the schema. Prune the swagger. Then send it into an{" "}
              <strong style={{ color: "var(--ink)" }}>anonymized duel</strong>. A friend ships,
              a judge decides. Nobody knows it&apos;s a game. Retire gaps and harden underdogs.
            </p>
            <div className="heroActions">
              <a className="btn" href="/submit">Submit your page</a>
              <a className="tlink" href="#scenarios">Explore scenarios</a>
            </div>
          </div>

          <aside className="boardCard" aria-label="Leaderboard summary">
            <dl className="boardCardHead">
              <div className="boardStat">
                <dt>Players</dt>
                <dd className="tnum">
                  {String(players.length).padStart(2, "0")}
                  <span className="sub">/ 5</span>
                </dd>
              </div>
              <div className="boardStat">
                <dt>Duels logged</dt>
                <dd className="tnum">{String(totalDuels).padStart(3, "0")}</dd>
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
              <h2>Every player. Every scenario.</h2>
            </div>
            <span className="sectionMeta">Baseline = 1000 · Goal = 2000</span>
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

        {/* ──── Players ──── */}
        {players.length > 0 && (
          <section className="section">
            <div className="sectionHead">
              <div>
                <p className="eyebrow">Roster</p>
                <h2>Who's in the arena.</h2>
              </div>
              <span className="sectionMeta">{players.length} player{players.length === 1 ? "" : "s"}</span>
            </div>
            <div className="cardGrid">
              {players.map((p) => (
                <a key={p.name} className="playerCard" href={`/players/${p.name}`}>
                  <span className="avatar" aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span>
                  <span className="name">{p.name}</span>
                  <span className="joined">
                    {new Date(p.joinedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* ──── How judging works ──── */}
        <section className="section">
          <div className="sectionHead">
            <div>
              <p className="eyebrow">The judge</p>
              <h2>Thinks it's helping a friend shop.</h2>
            </div>
            <span className="sectionMeta">Organic · anonymized · truthful</span>
          </div>
          <div className="explain">
            <div className="explainItem">
              <span className="num">01</span>
              <h4>Closed-set, order-neutral</h4>
              <p>Pages get shuffled and labeled A/B/C… Prompt says order doesn&apos;t matter. Judge has no idea this is a benchmark.</p>
            </div>
            <div className="explainItem">
              <span className="num">02</span>
              <h4>Entries are identical at first glance</h4>
              <p>Same brand, same product. The judge can&apos;t pick on branding. Structure, schema, copy and claim density decide it.</p>
            </div>
            <div className="explainItem">
              <span className="num">03</span>
              <h4>Lying loses hard</h4>
              <p>Fake awards, reviews, integrations, prices: the judge flags fabrication. Truth + structure beats swagger.</p>
            </div>
            <div className="explainItem">
              <span className="num">04</span>
              <h4>Pairwise or N-way</h4>
              <p>
                <code>duel.mjs</code> for 1v1. <code>bout.mjs</code> for free-for-all. Each match writes Elo back to this board.
              </p>
            </div>
          </div>
        </section>

        {/* ──── AEO surface ──── */}
        <section className="section">
          <div className="sectionHead">
            <div>
              <p className="eyebrow">Surface area</p>
              <h2>What you actually optimize.</h2>
            </div>
            <span className="sectionMeta">All real AEO levers</span>
          </div>
          <div className="explain">
            <div className="explainItem">
              <h4>Copy & heading structure</h4>
              <p>Answer-first hierarchy. Buyer-relevant claims surface first. H1 → H2 → H3 the way crawlers read.</p>
            </div>
            <div className="explainItem">
              <h4>llms.txt</h4>
              <p>Tight summary at <code>/players/&lt;you&gt;/&lt;scenario&gt;/llms.txt</code> for AI crawlers.</p>
            </div>
            <div className="explainItem">
              <h4>JSON-LD schema</h4>
              <p>Product · LocalBusiness · SoftwareApplication. Machine-readable claims.</p>
            </div>
            <div className="explainItem">
              <h4>Meta · OG · Twitter</h4>
              <p>Your <code>&lt;head&gt;</code> hoists into the document head. Title, description, canonical, OG.</p>
            </div>
            <div className="explainItem">
              <h4>Images + alt text</h4>
              <p>Alt text is content. Crawlers read it. So do screen readers.</p>
            </div>
            <div className="explainItem">
              <h4>robots.txt</h4>
              <p>Per-page crawler control. Drop one in your zip.</p>
            </div>
          </div>
        </section>

        {/* ──── Notes ──── */}
        <section className="section">
          <div className="sectionHead">
            <div>
              <p className="eyebrow">House notes</p>
              <h2>Suggestions from the friend group.</h2>
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
              <div className="formField">
                <label className="formLabel" htmlFor="fb-pw">Shared password</label>
                <input id="fb-pw" name="password" type="password" required placeholder="shared password" />
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

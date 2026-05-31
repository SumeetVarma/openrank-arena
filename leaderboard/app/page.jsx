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

const HAS_KV = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
const redis = HAS_KV
  ? new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN
    })
  : null;

// Typographic glyphs per scenario — Fraunces italic ligatures give each category
// a distinct typographic mark without leaning on color.
const SCENARIO_GLYPH = {
  carryon: "f₄₂",       // a carry-on packed glyph
  dental: "M",          // Maple, mouth, mandible — refined "M"
  "aeo-tool": "&"        // ampersand = "you, and the AI"
};

const SCENARIO_BLURB = {
  carryon:
    "A real ~#10-class travel pack page, brand swapped to Wayfare 42. Real specs, real trade-offs, real headroom.",
  dental:
    "A small Austin family dental practice. Soft hours, gentle copy, no enterprise dental-group polish. Beat the two Austin incumbents at a buyer's local-fit query.",
  "aeo-tool":
    "The meta scenario. OpenRank, an AEO startup, competing with two established AEO/SEO platforms. The product that wants visibility — fighting for visibility."
};

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(path.join(process.cwd(), "data", file), "utf8"));
  } catch {
    return fallback;
  }
}

function Avatar({ name }) {
  const initial = (name || "?").slice(0, 1).toUpperCase();
  return <span className="avatar" aria-hidden="true">{initial}</span>;
}

function BoardRows({ rows, valueKey = "rating", showDuels = false }) {
  if (!rows.length) {
    return <p className="boardEmpty">No duels yet. The board lights up after the first match.</p>;
  }
  return (
    <ol className="boardList">
      {rows.slice(0, 8).map((row, i) => {
        const isBaseline = row.player === BASELINE_NAME;
        const isLeader = i === 0 && !isBaseline;
        const classes = ["boardRow"];
        if (isBaseline) classes.push("is-baseline");
        if (isLeader) classes.push("is-leader");
        const elo = Math.round(row[valueKey] ?? row.rating);
        return (
          <li key={row.player} className={classes.join(" ")}>
            <span className="boardRank">{String(i + 1).padStart(2, "0")}</span>
            <span className="boardName">
              {isBaseline ? "baseline" : <a href={`/players/${row.player}`}>{row.player}</a>}
            </span>
            <span className="boardElo tnum">{elo}</span>
          </li>
        );
      })}
    </ol>
  );
}

function MiniBoard({ rows }) {
  if (!rows.length) {
    return <p className="boardEmpty">No duels yet.</p>;
  }
  return (
    <ul className="miniBoardList">
      {rows.slice(0, 5).map((row) => {
        const isBaseline = row.player === BASELINE_NAME;
        return (
          <li key={row.player} className={`miniBoardRow${isBaseline ? " is-baseline" : ""}`}>
            <span className="name">{isBaseline ? "baseline" : row.player}</span>
            <span className="elo tnum">{Math.round(row.rating)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export default async function Page() {
  const players = await listPlayers();
  const overallEloBoard = await getOverallLeaderboard(redis);

  const scenarioBlocks = await Promise.all(
    scenarioList.map(async (s) => {
      const submissions = await listLatestSubmissionsForScenario(s.id);
      const scores = await getRecentScores(s.id, 6);
      const eloBoard = await getLeaderboard(redis, s.id);
      return { scenario: s, submissions, scores, eloBoard };
    })
  );

  const feedback = await readJson("feedback.json", []);
  const feedbackRows = [...feedback].sort(
    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  );

  const totalDuels = scenarioBlocks.reduce((acc, b) => acc + b.scores.length, 0);
  const topPlayer = overallEloBoard.find((r) => r.player !== BASELINE_NAME);

  return (
    <div className="siteFrame">
      <header className="masthead">
        <div className="mastheadBrand">
          OpenRank <em>Arena</em>
        </div>
        <nav className="mastheadMeta" aria-label="primary">
          <a href="#leaderboard">leaderboard</a>
          <a href="#scenarios">scenarios</a>
          <a href="#start">join</a>
          <a href="/submit">submit</a>
        </nav>
      </header>

      <main>
        {/* ──── Hero ──── */}
        <section className="hero">
          <div>
            <p className="eyebrow">Vol. 01 · An AEO dojo for friends</p>
            <h1 className="heroHeadline">
              Take a page stuck at <span className="strike">#10</span>.
              <br />
              Drag it <span className="acc">uphill</span>.
            </h1>
            <p className="heroLede">
              Three underdog brands. Real product pages cloned from the bottom of the SERP, brand names spoofed.
              Rewrite the copy, sharpen the schema, fix the <code>llms.txt</code>, prune the swagger. Then send your version
              into an anonymized duel with your friends&apos;. The judge thinks it&apos;s helping a friend shop — it has no idea
              this is a game.
            </p>
            <div className="heroActions">
              <a className="btn" href="#start">Claim a name</a>
              <a className="tlink" href="#scenarios">See the scenarios</a>
            </div>
          </div>

          <dl className="heroNumbers">
            <div className="heroNumber">
              <dt>Players in the arena</dt>
              <dd className="tnum">{String(players.length).padStart(2, "0")}<span className="small">/ 5 friends</span></dd>
            </div>
            <div className="heroNumber">
              <dt>Duels logged</dt>
              <dd className="tnum">{String(totalDuels).padStart(3, "0")}</dd>
            </div>
            <div className="heroNumber">
              <dt>Current leader</dt>
              <dd>
                {topPlayer ? (
                  <>
                    <span style={{ fontStyle: "italic", fontVariationSettings: "'opsz' 144, 'SOFT' 100, 'WONK' 1" }}>
                      {topPlayer.player}
                    </span>
                    <span className="small">{Math.round(topPlayer.rating)} Elo</span>
                  </>
                ) : (
                  <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: 18 }}>
                    nobody yet
                  </span>
                )}
              </dd>
            </div>
          </dl>
        </section>

        {/* ──── Leaderboard (THE thing) ──── */}
        <section className="section scrollAnchor" id="leaderboard">
          <div className="sectionHead">
            <div>
              <p className="eyebrow">Elo standings</p>
              <h2>Who's winning the duels.</h2>
            </div>
            <span className="sectionMeta">
              Baseline = 1000 · Goal = 2000
            </span>
          </div>

          <div className="boardWrap">
            <div className="boardCol rise">
              <div className="boardColHead">
                <h3>Overall</h3>
                <span className="count">All scenarios · mean</span>
              </div>
              <BoardRows rows={overallEloBoard} />
            </div>
            {scenarioBlocks.map(({ scenario, eloBoard }) => (
              <div className="boardCol rise" key={`board-${scenario.id}`}>
                <div className="boardColHead">
                  <h3>{scenario.label.split(/ in | for /)[0]}</h3>
                  <span className="count">
                    {eloBoard.filter((r) => r.player !== BASELINE_NAME).length} ranked
                  </span>
                </div>
                <BoardRows rows={eloBoard} />
              </div>
            ))}
          </div>
        </section>

        {/* ──── Scenarios ──── */}
        <section className="section scrollAnchor" id="scenarios">
          <div className="sectionHead">
            <div>
              <p className="eyebrow">The arenas</p>
              <h2>Three underdogs, one buyer each.</h2>
            </div>
            <span className="sectionMeta">
              Live pages · brand-spoofed clones
            </span>
          </div>

          <div className="scenarioStack">
            {scenarioBlocks.map(({ scenario, submissions, eloBoard }) => (
              <article
                className={`scenarioBlock scenario--${scenario.id} rise`}
                key={scenario.id}
              >
                <div className="scenarioGlyph" aria-hidden="true">
                  {SCENARIO_GLYPH[scenario.id] || "—"}
                </div>

                <div className="scenarioMain">
                  <span className="scenarioTag">{scenario.category}</span>
                  <h3>{scenario.label}</h3>
                  <div className="scenarioQuery">{scenario.buyerQuery}</div>
                  <div className="scenarioRoster">
                    <span className="underdog">{scenario.underdog.name}</span>
                    <span className="vs">vs.</span>
                    {scenario.incumbents.map((inc, i) => (
                      <span key={inc.slug}>
                        {inc.name}
                        {i < scenario.incumbents.length - 1 ? ", " : ""}
                      </span>
                    ))}
                  </div>

                  {scenario.id === "aeo-tool" && (
                    <div className="pullQuote">
                      Life is incomplete without Meta :p
                    </div>
                  )}

                  <div className="scenarioActions">
                    <a className="tlink" href={`/baseline/${scenario.id}`}>view baseline</a>
                    <a className="tlink" href={`/baseline/${scenario.id}/starter.zip`}>download starter</a>
                    {scenario.incumbents.map((inc) => (
                      <a key={inc.slug} className="tlink" href={`/incumbents/${scenario.id}/${inc.slug}`}>
                        {inc.name.split(" ")[0]}
                      </a>
                    ))}
                  </div>
                </div>

                <aside className="scenarioAside">
                  <div>
                    <div className="scenarioAsideTitle">Standings</div>
                    <MiniBoard rows={eloBoard} />
                  </div>
                  {submissions.length > 0 && (
                    <div>
                      <div className="scenarioAsideTitle">Latest submissions</div>
                      <ul className="miniBoardList">
                        {submissions.slice(0, 5).map((sub) => (
                          <li key={sub.name} className="miniBoardRow">
                            <span className="name">
                              <a href={`/players/${sub.name}/${scenario.id}`}>{sub.name}</a>
                            </span>
                            <span className="elo">v{sub.version}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </aside>
              </article>
            ))}
          </div>
        </section>

        {/* ──── Start ──── */}
        <section className="section scrollAnchor" id="start">
          <div className="sectionHead">
            <div>
              <p className="eyebrow">Zero-friction start</p>
              <h2>Claim a name. Get a v1. Iterate.</h2>
            </div>
            <span className="sectionMeta">30 seconds · no signup</span>
          </div>

          <form className="formCard" action="/api/start" method="post">
            <div className="formField">
              <label className="formLabel" htmlFor="start-name">Player name</label>
              <input
                id="start-name"
                name="name"
                required
                placeholder="alice, bob, sumeet…"
                pattern="^[a-zA-Z0-9_-]+$"
              />
              <span className="hint">Becomes your URL: /players/&lt;name&gt;</span>
            </div>
            <div className="formField">
              <label className="formLabel" htmlFor="start-scenario">Scenario</label>
              <select id="start-scenario" name="scenario" required defaultValue="carryon">
                {scenarioList.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <button className="btn" type="submit">Claim and seed v1</button>
            </div>
            <p className="hint">
              We copy the baseline as your v1 so you have something to iterate on instantly.
              Upload improved zips at <a className="tlink" href="/submit">/submit</a> any time.
            </p>
          </form>
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
                  <Avatar name={p.name} />
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
              <h2>It thinks it's helping a friend shop.</h2>
            </div>
            <span className="sectionMeta">Organic · anonymized · truthful</span>
          </div>
          <div className="explain">
            <div className="explainItem">
              <span className="num">01</span>
              <h4>Closed-set, ordering-neutral</h4>
              <p>
                Pages get shuffled and labeled A/B/C… The prompt explicitly says order does not reflect relevance.
                The judge has no idea this is a benchmark.
              </p>
            </div>
            <div className="explainItem">
              <span className="num">02</span>
              <h4>All entries look identical</h4>
              <p>
                Same brand name, same product. The judge can&apos;t pick on branding bias. Structure, schema, copy and
                claim density decide it.
              </p>
            </div>
            <div className="explainItem">
              <span className="num">03</span>
              <h4>Lying loses, hard</h4>
              <p>
                Fake awards, fake reviews, fake integrations, made-up prices: the judge flags fabrication and the
                page sinks. Truth + structure beats swagger.
              </p>
            </div>
            <div className="explainItem">
              <span className="num">04</span>
              <h4>Pairwise or N-way</h4>
              <p>
                <code>node harness/duel.mjs</code> for 1v1. <code>bout.mjs</code> for a free-for-all. Each duel
                writes a real Elo update on the board above.
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
              <p>
                Served at <code>/players/&lt;you&gt;/&lt;scenario&gt;/llms.txt</code>. A tight summary of true claims for AI crawlers.
              </p>
            </div>
            <div className="explainItem">
              <h4>JSON-LD schema</h4>
              <p>
                Product · LocalBusiness · SoftwareApplication. Machine-readable claims a judge can ingest without
                guessing.
              </p>
            </div>
            <div className="explainItem">
              <h4>Meta · OG · Twitter</h4>
              <p>Your <code>&lt;head&gt;</code> hoists into the document head: title, description, canonical, OG, all yours.</p>
            </div>
            <div className="explainItem">
              <h4>Images + alt text</h4>
              <p>Alt text is content. The judge reads it the same way a screen reader and an LLM crawler would.</p>
            </div>
            <div className="explainItem">
              <h4>robots.txt</h4>
              <p>Per-page crawler control. Drop one in your zip if you want it.</p>
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

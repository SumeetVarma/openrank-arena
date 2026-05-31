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
  SEED_ELO,
  BASELINE_NAME
} from "../lib/elo.mjs";

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

export default async function Page() {
  const players = await listPlayers();

  const overallEloBoard = await getOverallLeaderboard(redis);

  const scenarioCards = await Promise.all(
    scenarioList.map(async (s) => {
      const submissions = await listLatestSubmissionsForScenario(s.id);
      const scores = await getRecentScores(s.id, 10);
      const eloBoard = await getLeaderboard(redis, s.id);
      return { scenario: s, submissions, scores, eloBoard };
    })
  );

  const feedback = await readJson("feedback.json", []);
  const feedbackRows = [...feedback].sort(
    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  );

  return (
    <main>
      <section className="hero">
        <div className="heroCopy">
          <p className="eyebrow">OpenRank Arena</p>
          <h1>Practice AEO. Beat the incumbents. Iterate fast.</h1>
          <p>
            A closed-arena answer engine optimization benchmark for friends. Pick a scenario, optimize the underdog
            page until an AI judge prefers it over the incumbents — and try not to fabricate anything along the way.
          </p>
          <p style={{ marginTop: 14 }}>
            <a href="#start" style={{ color: "var(--clay-dark)", fontWeight: 600 }}>
              Get started in 30 seconds →
            </a>
            {"  ·  "}
            <a href="/submit" style={{ color: "var(--clay-dark)" }}>upload a zip</a>
          </p>
        </div>
        <div className="heroPanel" aria-label="How it works">
          <div>
            <strong>1 · Pick a scenario</strong>
            <span>Each one has a real #10-ranked underdog and 3–4 spoofed incumbents.</span>
          </div>
          <div>
            <strong>2 · Optimize the page</strong>
            <span>Upload a zip with index.html, llms.txt, JSON-LD, images. Iterate as many times as you want.</span>
          </div>
          <div>
            <strong>3 · Judge it</strong>
            <span>An AI judge picks the buyer's recommendation from the candidate pool. Truthful wins.</span>
          </div>
        </div>
      </section>

      <section>
        <div className="sectionHead">
          <div>
            <p className="eyebrow">Elo standings</p>
            <h2>Who's winning the duels</h2>
          </div>
          <span>baseline = 1000 · goal = 2000</span>
        </div>
        <div className="cards">
          <article className="scenarioCard">
            <h3>Overall</h3>
            <p className="small">Average Elo across all scenarios played</p>
            <ol style={{ paddingLeft: 20, margin: "8px 0 0 0", fontSize: 14 }}>
              {overallEloBoard.slice(0, 10).map((r) => (
                <li key={r.player} style={{ padding: "4px 0", color: r.player === BASELINE_NAME ? "var(--muted)" : "var(--ink)" }}>
                  <strong>{r.player}</strong> · {Math.round(r.rating)}
                  {r.scenariosPlayed > 0 && (
                    <span style={{ color: "var(--muted)" }}> · {r.scenariosPlayed} scenarios</span>
                  )}
                </li>
              ))}
            </ol>
          </article>
          {scenarioCards.map(({ scenario, eloBoard }) => (
            <article className="scenarioCard" key={`elo-${scenario.id}`}>
              <h3>{scenario.label}</h3>
              <p className="small">{eloBoard.filter((r) => r.player !== BASELINE_NAME).length} player{eloBoard.length === 1 ? "" : "s"} with duels</p>
              <ol style={{ paddingLeft: 20, margin: "8px 0 0 0", fontSize: 14 }}>
                {eloBoard.slice(0, 10).map((r) => (
                  <li key={r.player} style={{ padding: "4px 0", color: r.player === BASELINE_NAME ? "var(--muted)" : "var(--ink)" }}>
                    <strong>{r.player}</strong> · {Math.round(r.rating)}
                    {r.duels > 0 && (
                      <span style={{ color: "var(--muted)" }}> · {r.duels} duel{r.duels === 1 ? "" : "s"}</span>
                    )}
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      </section>

      <section id="start">
        <div className="sectionHead">
          <div>
            <p className="eyebrow">Zero-friction start</p>
            <h2>Claim a name, seed your v1, iterate</h2>
          </div>
          <span>30 seconds to be on the board</span>
        </div>
        <form className="submitForm" action="/api/start" method="post">
          <label>
            Pick a name (becomes your URL: <code>/players/&lt;name&gt;/...</code>)
            <input name="name" required placeholder="alice, bob, sumeet..." pattern="^[a-zA-Z0-9_-]+$" />
          </label>
          <label>
            Scenario to start with
            <select name="scenario" required defaultValue="carryon">
              {scenarioList.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </label>
          <button type="submit">Claim name & create v1 from baseline →</button>
          <p className="small" style={{ marginTop: 4 }}>
            This seeds a v1 submission identical to the baseline. You're instantly live at <code>/players/&lt;name&gt;/&lt;scenario&gt;</code> and can upload improved versions any time from <a href="/submit">/submit</a>.
          </p>
        </form>
      </section>

      <section>
        <div className="sectionHead">
          <div>
            <p className="eyebrow">Playground</p>
            <h2>Scenarios</h2>
          </div>
          <span>{players.length} player{players.length === 1 ? "" : "s"} in the arena</span>
        </div>
        <div className="cards">
          {scenarioCards.map(({ scenario, submissions, scores }) => (
            <article className="scenarioCard" key={scenario.id}>
              <p className="tag">{scenario.category}</p>
              <h3>{scenario.label}</h3>
              <p className="small">Buyer query: <em>"{scenario.buyerQuery}"</em></p>
              <p className="small">
                Underdog: <strong>{scenario.underdog.name}</strong> · Incumbents: {scenario.incumbents.map((i) => i.name).join(", ")}
              </p>
              <div className="links">
                <a href={`/baseline/${scenario.id}`}>baseline →</a>
                <a href={`/baseline/${scenario.id}/starter.zip`}>download starter.zip →</a>
                {scenario.incumbents.map((i) => (
                  <a key={i.slug} href={`/incumbents/${scenario.id}/${i.slug}`}>
                    {i.name} →
                  </a>
                ))}
              </div>
              {submissions.length > 0 && (
                <div className="links" style={{ marginTop: 4 }}>
                  <strong style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    Submissions:
                  </strong>
                  {submissions.map((sub) => (
                    <a key={sub.name} href={`/players/${sub.name}/${scenario.id}`}>
                      {sub.name} (v{sub.version}) →
                    </a>
                  ))}
                </div>
              )}
              {scores.length > 0 && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
                  <strong style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    Recent judge runs ({scores.length})
                  </strong>
                  <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0 0", fontSize: 13 }}>
                    {scores.slice(0, 5).map((r) => {
                      const winnerLabel = r.pick;
                      const winnerEntry = (r.labeled || []).find((l) => l.label === winnerLabel);
                      const winnerName = winnerEntry?.slug?.startsWith("player:")
                        ? winnerEntry.slug.replace("player:", "")
                        : winnerEntry?.slug || "?";
                      return (
                        <li key={r.runId} style={{ padding: "4px 0", color: "var(--muted)" }}>
                          <strong style={{ color: "var(--ink)" }}>{winnerName}</strong> picked · by {r.runner} · {r.model} · {new Date(r.ranAt).toLocaleString()}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      <section>
        <div className="sectionHead">
          <div>
            <p className="eyebrow">Players</p>
            <h2>Who's in the arena</h2>
          </div>
          <span>any name, any time</span>
        </div>
        {players.length ? (
          <div className="cards">
            {players.map((p) => (
              <article className="card" key={p.name}>
                <h3>{p.name}</h3>
                <p className="small">Joined {new Date(p.joinedAt).toLocaleDateString()}</p>
                <p>
                  <a href={`/players/${p.name}`}>profile →</a>
                </p>
              </article>
            ))}
          </div>
        ) : (
          <p>No players yet. The first submission claims a name and lights up the board.</p>
        )}
      </section>

      <section>
        <div className="sectionHead">
          <div>
            <p className="eyebrow">Judging</p>
            <h2>How an AI judge sees this</h2>
          </div>
          <span>closed-set, ordering-neutral</span>
        </div>
        <div className="rulesGrid">
          <article>
            <strong>Buyer framing</strong>
            <p>The judge thinks it's helping a friend shop. No mention of arena, leaderboard, or "submissions."</p>
          </article>
          <article>
            <strong>Order doesn't matter</strong>
            <p>Pages are shuffled and labeled A/B/C... The prompt explicitly says order does not reflect relevance.</p>
          </article>
          <article>
            <strong>Truthful wins</strong>
            <p>Fabricating claims about the target caps your run at half score. Recommend based on what's actually on the page.</p>
          </article>
          <article>
            <strong>JSON output</strong>
            <p>Judge returns a pick, full ranking, per-page reasoning, and fabrication flags. We parse and score.</p>
          </article>
        </div>
      </section>

      <section>
        <div className="sectionHead">
          <div>
            <p className="eyebrow">AEO surface</p>
            <h2>What to optimize</h2>
          </div>
          <span>this is what real AEO companies tune</span>
        </div>
        <div className="rulesGrid">
          <article>
            <strong>Page copy + structure</strong>
            <p>Headings, sections, sentence structure. Match the buyer's mental model.</p>
          </article>
          <article>
            <strong>llms.txt</strong>
            <p>Served at <code>/players/&lt;you&gt;/&lt;scenario&gt;/llms.txt</code>. Write a clean summary of your page's true claims.</p>
          </article>
          <article>
            <strong>JSON-LD structured data</strong>
            <p>Product / LocalBusiness / SoftwareApplication. Machine-readable claims AI engines can ingest.</p>
          </article>
          <article>
            <strong>Meta tags, OG, Twitter cards</strong>
            <p>Your <code>&lt;head&gt;</code> tags hoist into the page head. Title, description, canonical, OG, all yours.</p>
          </article>
          <article>
            <strong>Images + alt text</strong>
            <p>Visual evidence and accessibility. Alt text is AEO content too.</p>
          </article>
          <article>
            <strong>robots.txt</strong>
            <p>If you want to control crawlers per-page, include one in your zip.</p>
          </article>
        </div>
      </section>

      <section>
        <div className="sectionHead">
          <div>
            <p className="eyebrow">Notes from the friend group</p>
            <h2>Suggestions & feedback</h2>
          </div>
          <span>{feedbackRows.length} note{feedbackRows.length === 1 ? "" : "s"}</span>
        </div>
        <form className="feedbackForm" action="/api/feedback" method="post">
          <label>
            Name
            <input name="name" placeholder="your name" />
          </label>
          <label>
            Note
            <textarea name="message" placeholder="Anything: scenario ideas, judge prompt tweaks, things that broke..." required />
          </label>
          <label>
            Shared password
            <input name="password" type="password" placeholder="shared password" required />
          </label>
          <button type="submit">Send</button>
        </form>
        <div className="feedbackFeed" aria-label="Notes feed">
          <div className="feedHead">
            <strong>Notes</strong>
            <span>{feedbackRows.length ? "Newest first" : "No notes yet"}</span>
          </div>
          {feedbackRows.length ? (
            feedbackRows.map((row, index) => (
              <article className="feedbackNote" key={`${row.createdAt}-${index}`}>
                <div>
                  <strong>{row.name || "Anonymous"}</strong>
                  <span>{row.createdAt ? new Date(row.createdAt).toLocaleString() : "Just now"}</span>
                </div>
                <p>{row.message}</p>
              </article>
            ))
          ) : (
            <div className="emptyFeedback">Drop scenario ideas, judge tweaks, or just say hi.</div>
          )}
        </div>
      </section>
    </main>
  );
}

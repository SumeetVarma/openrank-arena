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
import PromptTabs from "./_components/PromptTabs.jsx";
import CountUp from "./_components/CountUp.jsx";
import LivePulse from "./_components/LivePulse.jsx";
import JudgePromptViewer from "./_components/JudgePromptViewer.jsx";

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
    // @upstash/redis returns objects directly (auto-deserialized).
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
  // Curated, leak-safe hero images per scenario. The cloned source images for
  // dental + aeo-tool would expose original brand identity; carry-on's cloned
  // asset is the underdog backpack itself, which is fine.
  if (scenarioId === "dental") return "/scenarios/dental.jpg";
  if (scenarioId === "aeo-tool") return "/scenarios/openrank.jpg";
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
  // Total submissions across all scenarios (count the actual submission events
  // emitted by getRecentActivity — it already pulls latest-per-player-per-scenario).
  const totalSubmissions = recentActivity.filter((e) => e.kind === "submission").length;
  const lastEventAt = recentActivity[0]?.uploadedAt || recentActivity[0]?.ranAt || null;

  const recentSubmissions = recentActivity.filter((e) => e.kind === "submission");
  const recentActivityBlock = recentSubmissions.length > 0 ? (
    <section className="section">
      <div className="sectionHead">
        <div>
          <p className="eyebrow">Activity</p>
          <h2>Recent submissions</h2>
        </div>
        <span className="sectionMeta">{recentSubmissions.length} upload{recentSubmissions.length === 1 ? "" : "s"} · click to view the page</span>
      </div>
      <ul className="activityFeed">
        {recentSubmissions.map((e, i) => {
          const scenario = scenarioList.find((s) => s.id === e.scenarioId);
          const when = relTime(e.ranAt || e.uploadedAt);
          // Link to the specific version so historical entries don't jump to
          // whatever happens to be latest right now.
          const href = e.version
            ? `/players/${e.name}/${e.scenarioId}/v/${e.version}`
            : `/players/${e.name}/${e.scenarioId}`;
          const shortId = e.version ? String(e.version).slice(0, 6) : null;
          return (
            <li className="activityItem activityItem--link" key={`a${i}`}>
              <a className="activityRowLink" href={href} aria-label={`${e.name}'s ${scenario?.shortLabel} submission ${shortId || ""}`}>
                <span className="activityWho">{e.name}</span>
                <span className="activityVerb">submitted</span>
                <span className="activityWhat">
                  {scenario?.shortLabel}
                  {shortId && (
                    <span className="mono activityId">#{shortId}</span>
                  )}
                </span>
                {e.note && (
                  <span className="activityNote">&ldquo;{e.note.length > 70 ? e.note.slice(0, 70) + "…" : e.note}&rdquo;</span>
                )}
                <span className="activityWhen">{when}</span>
                <span className="activityArrow" aria-hidden>→</span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  ) : null;


  return (
    <div className="siteFrame">
      {/* MASTHEAD */}
      <header className="masthead">
        <div className="mastheadBrand">
          OpenRank <em>Arena</em>
        </div>
        <nav className="mastheadMeta" aria-label="primary">
          <LivePulse lastEventAt={lastEventAt} />
          <a href="#leaderboard">Leaderboard</a>
          <a href="#scenarios">Scenarios</a>
          <a href="#judge">Judge prompt</a>
          <a href="#feedback">Notes</a>
          <a className="btn btn--sm" href="#submit" style={{ marginLeft: 8 }}>Submit</a>
        </nav>
      </header>

      <main>
        {/* ── 1. HERO — two-column with live preview ── */}
        <section className="heroSplit">
          <div className="heroSplitLeft">
            <p className="heroFinalEyebrow">An AEO benchmark</p>
            <h1 className="heroFinalHead">
              Optimize the hell<br />
              out of a page ranked<br />
              <span className="acc">#10</span> in AI.
            </h1>
            <p className="heroFinalLede">
              ChatGPT and Claude only cite a few pages when they answer buyer questions.
              <strong> AEO is the work of becoming one of them.</strong>
            </p>
            <p className="heroFinalLede" style={{ marginTop: 0 }}>
              Pick one of three underdog pages. Rewrite it. Upload your zip. A blind judge compares
              your version against your friends&apos; — Elo updates land on the board.
            </p>
            <div className="heroFinalActions">
              <a className="btn" href="#submit">Submit your page</a>
              <a className="tlink" href="#leaderboard">View leaderboard</a>
            </div>
            <dl className="heroStats">
              <div className="rise" style={{ animationDelay: "120ms" }}>
                <dt>Players</dt>
                <dd><CountUp value={players.length} /></dd>
              </div>
              <div className="rise" style={{ animationDelay: "200ms" }}>
                <dt>Submissions</dt>
                <dd><CountUp value={totalSubmissions} /></dd>
              </div>
              <div className="rise" style={{ animationDelay: "280ms" }}>
                <dt>Top Elo</dt>
                <dd><CountUp value={topPlayer ? Math.round(topPlayer.overall) : 1000} /></dd>
              </div>
            </dl>
          </div>

          <div className="heroSplitRight">
            <PromptTabs scenarios={scenariosMeta.map((m, i) => ({ ...m, buyerQuery: scenarioList[i].buyerQuery }))} />
          </div>
        </section>

        {/* ── 2. LEADERBOARD — the centerpiece, big ── */}
        <section className="section scrollAnchor" id="leaderboard">
          <div className="sectionHead">
            <div>
              <p className="eyebrow">Standings</p>
              <h2>Leaderboard</h2>
            </div>
            <span className="sectionMeta">
              {players.length} player{players.length === 1 ? "" : "s"} · unranked scenarios sit at baseline 1000 · click any cell to view that page
            </span>
          </div>
          {players.length === 0 ? (
            <div className="emptyBoard">
              <p className="emptyBoardHead">No one&apos;s climbed yet.</p>
              <p className="emptyBoardSub">First submission claims the top of the board.</p>
              <a className="btn" href="#submit">Be first</a>
            </div>
          ) : (
            <Leaderboard rows={tableRows} scenarios={scenariosMeta} />
          )}
        </section>

        {recentActivityBlock}

        {/* ── 3. SCENARIOS — three cards, properly aligned ── */}
        <section className="section scrollAnchor" id="scenarios">
          <div className="sectionHead">
            <div>
              <p className="eyebrow">Arenas</p>
              <h2>Three underdog pages</h2>
            </div>
            <span className="sectionMeta">brand-spoofed clones of real pages ranked #10 in Search</span>
          </div>
          <div className="featureRow">
            {scenarioCards.map(({ scenario, heroImage }) => {
              return (
                <div
                  key={scenario.id}
                  className={`featureCard scenario--${scenario.id}`}
                >
                  <div className="featureImage">
                    {heroImage ? (
                      <img src={heroImage} alt={`${scenario.underdog.name} baseline`} loading="lazy" />
                    ) : (
                      <div style={{
                        width: "100%",
                        height: "100%",
                        display: "grid",
                        placeItems: "center",
                        background: "var(--paper-deep)",
                        color: "var(--ink-mute)"
                      }}>
                        <span style={{
                          fontFamily: "var(--font-display)",
                          fontStyle: "italic",
                          fontSize: 52,
                          letterSpacing: "-0.02em",
                          fontVariationSettings: "'opsz' 144, 'SOFT' 100, 'WONK' 1",
                          textAlign: "center",
                          padding: "0 20px"
                        }}>
                          {scenario.underdog.name}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="featureBody">
                    <p className="featureCategory">{scenario.category}</p>
                    <h3>{scenario.underdog.name}</h3>
                    <p className="featureVs">vs {scenario.incumbents.map((i) => i.name).join(" · ")}</p>
                    <p className="featureBuyer">
                      &ldquo;{scenario.buyerQuery.length > 95 ? scenario.buyerQuery.slice(0, 95) + "…" : scenario.buyerQuery}&rdquo;
                    </p>
                    <div className="featureActions">
                      <a className="tlink" href={`/baseline/${scenario.id}`}>View baseline →</a>
                      <a className="tlink featureStarter" href={`/baseline/${scenario.id}/starter.zip`} download>
                        ↓ starter.zip
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── 4. HOW IT WORKS ── */}
        <section className="section scrollAnchor" id="how">
          <div className="sectionHead">
            <div>
              <p className="eyebrow">How it works</p>
              <h2>The whole game in four steps</h2>
            </div>
            <span className="sectionMeta">no signup · no cost · no setup</span>
          </div>

          <ol className="howSteps">
            <li>
              <span className="howNum">01</span>
              <div>
                <h3>Pick a scenario</h3>
                <p>Three underdog pages, each a spoofed clone of a real page ranked #10.</p>
              </div>
            </li>
            <li>
              <span className="howNum">02</span>
              <div>
                <h3>Rewrite the page</h3>
                <p>Ship a zip with <code>index.html</code>, <code>llms.txt</code>, and <code>assets/</code>.</p>
              </div>
            </li>
            <li>
              <span className="howNum">03</span>
              <div>
                <h3>Anyone runs a match</h3>
                <p>A blind judge compares your version against the others. Fakes get penalized.</p>
              </div>
            </li>
            <li>
              <span className="howNum">04</span>
              <div>
                <h3>Elo lands on the board</h3>
                <p>Pairwise Elo, baseline anchored at 1000.</p>
              </div>
            </li>
          </ol>

          <aside className="finalRoundCallout">
            <p className="eyebrow" style={{ marginBottom: 6 }}>Final round</p>
            <h3>Final ranking is on a hidden dataset.</h3>
            <p>
              At the end of the competition, every submission is re-judged on a held-out set of
              scenarios nobody has seen. Hand-tuning the three visible pages won&apos;t cut it —
              build a real pipeline that generalizes.
            </p>
          </aside>

          <aside className="prizeBoard" id="prizes">
            <p className="eyebrow" style={{ marginBottom: 6 }}>Prizes</p>
            <h3>What you&apos;re actually playing for</h3>
            <ul className="prizeList">
              <li className="prizeRow prizeRow--gold">
                <span className="prizeMedal" aria-hidden>🥇</span>
                <div>
                  <p className="prizeTitle">Respect.</p>
                  <p className="prizeSub">Pinned at the top of the board until someone takes it from you.</p>
                </div>
              </li>
              <li className="prizeRow prizeRow--silver">
                <span className="prizeMedal" aria-hidden>🥈</span>
                <div>
                  <p className="prizeTitle">Cope rights.</p>
                  <p className="prizeSub">License to say &ldquo;I was robbed by the hidden set.&rdquo;</p>
                </div>
              </li>
              <li className="prizeRow prizeRow--bronze">
                <span className="prizeMedal" aria-hidden>🥉</span>
                <div>
                  <p className="prizeTitle">A coffee.</p>
                  <p className="prizeSub">Winner buys. You earned it by being slightly more credible than a baseline LLM.</p>
                </div>
              </li>
              <li className="prizeRow prizeRow--wood">
                <span className="prizeMedal" aria-hidden>🪵</span>
                <div>
                  <p className="prizeTitle">Last place.</p>
                  <p className="prizeSub">Custom title in the group chat. Non-negotiable. Lasts one month.</p>
                </div>
              </li>
            </ul>
          </aside>

          <div className="howCta">
            <p>Ready?</p>
            <a className="btn" href="#submit">Submit your first page</a>
          </div>
        </section>

        {/* ── 5. SUBMIT — compact strip ── */}
        <section className="section scrollAnchor" id="submit">
          <div className="sectionHead">
            <div>
              <p className="eyebrow">How to play</p>
              <h2>Three minutes from clone to ranked</h2>
            </div>
            <span className="sectionMeta">no signup · first upload claims your name</span>
          </div>

          <div className="submitThreeUp">
            <div className="zipPanel">
              <p className="zipPanelTitle">Your zip</p>
              <ul className="zipList">
                <li>
                  <code>index.html</code>
                  <span className="req">required</span>
                  <p>Real semantic HTML. Headings, JSON-LD inline, meta in <code>&lt;head&gt;</code>.</p>
                </li>
                <li>
                  <code>llms.txt</code>
                  <span className="rec">recommended</span>
                  <p>Plain-text summary at <code>/llms.txt</code> for AI crawlers.</p>
                </li>
                <li>
                  <code>assets/</code>
                  <span className="rec">recommended</span>
                  <p>Images and static files. Reference as <code>assets/foo.jpg</code>.</p>
                </li>
                <li>
                  <code>robots.txt</code>
                  <span className="opt">optional</span>
                  <p>Per-page crawler rules. Permissive by default.</p>
                </li>
              </ul>
            </div>

            <div className="cliPanel" style={{ alignSelf: "start" }}>
              <p className="cliPanelTitle">From your terminal · or your AI agent</p>
              <pre>{`git clone https://github.com/SumeetVarma/openrank-arena
cd openrank-arena

node harness/submit.mjs \\
  --name i-forgot-to-update-my-name \\
  --scenario carryon \\
  --dir ./my-page \\
  --note "tightened headings"`}</pre>
              <p className="cliHint">
                Or tell <span className="em">Claude / Codex / Cursor</span>:
                &ldquo;<span className="em">submit my page to openrank-arena</span>&rdquo; — the agent
                clones the repo and runs it for you.
              </p>
              <p className="cliHint" style={{ marginTop: 10 }}>
                No terminal? <a className="tlink" href="/submit" style={{ color: "var(--ember-soft)", borderColor: "var(--ember-soft)" }}>Upload a zip in the browser →</a>
              </p>
            </div>
          </div>
        </section>

        {/* ── 6. JUDGE PROMPT — what the LLM actually reads ── */}
        <section className="section scrollAnchor" id="judge">
          <div className="sectionHead">
            <div>
              <p className="eyebrow">Transparency</p>
              <h2>What the judge sees</h2>
            </div>
            <span className="sectionMeta">tab through scenarios · prompt template is identical across all matches</span>
          </div>
          <JudgePromptViewer scenarios={scenarioList.map((s) => ({
            id: s.id,
            shortLabel: s.shortLabel,
            buyerQuery: s.buyerQuery
          }))} />
        </section>

        {/* ── 7. FEEDBACK + SCENARIO REQUESTS ── */}
        <section className="section scrollAnchor" id="feedback">
          <div className="sectionHead">
            <div>
              <p className="eyebrow">From the floor</p>
              <h2>Notes &amp; scenario requests</h2>
            </div>
            <span className="sectionMeta">{feedbackRows.length} note{feedbackRows.length === 1 ? "" : "s"}</span>
          </div>

          <div className="feedbackGrid">
            <div className="feedbackList">
              {feedbackRows.length === 0 ? (
                <div className="feedbackEmpty">
                  <p>No notes yet. Be the first to drop one.</p>
                </div>
              ) : (
                <ul className="feedbackItems">
                  {feedbackRows.map((f, i) => (
                    <li className="feedbackItem" key={`fb-${i}`}>
                      <header className="feedbackHead">
                        <span className="feedbackName">{f.name || "Anonymous"}</span>
                        <span className="feedbackWhen">{relTime(f.createdAt)}</span>
                      </header>
                      <p className="feedbackBody">{f.message}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <aside className="feedbackForm">
              <p className="feedbackFormTitle">Want a new scenario? Got a take?</p>
              <p className="feedbackFormSub">
                Suggest a category we should add (legal services? coffee subscription?
                vibe-coding tools?), call out something that doesn&apos;t work, or just
                say what you tried. Everyone sees it.
              </p>
              <form action="/api/feedback" method="post">
                <label className="formField">
                  <span className="formLabel">Your name</span>
                  <input name="name" placeholder="alice, bob, sumeet…" maxLength={80} autoComplete="off" />
                </label>
                <label className="formField">
                  <span className="formLabel">Note</span>
                  <textarea
                    name="message"
                    required
                    rows={4}
                    maxLength={2000}
                    placeholder="Suggest a new scenario, report a bug, or share a tactic that worked…"
                  />
                </label>
                <button className="btn" type="submit">Post note</button>
              </form>
            </aside>
          </div>
        </section>

      </main>

      {/* CLIMB BAR */}
      <div className="climbBar">
        <strong>Think you can beat #10? Climb the board.</strong>
        <a className="climbCta" href="#submit">Submit your page ↗</a>
      </div>

      {/* FOOTER */}
      <footer className="siteFoot">
        <span>OpenRank Arena · An AEO benchmark</span>
        <span>
          <a className="tlink" href="https://github.com/SumeetVarma/openrank-arena">source</a>
          {" · "}
          <a className="tlink" href="https://github.com/SumeetVarma/openrank-arena/blob/main/harness/match.mjs">judge prompt</a>
        </span>
      </footer>
    </div>
  );
}

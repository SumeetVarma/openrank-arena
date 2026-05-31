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
      {/* MASTHEAD */}
      <header className="masthead">
        <div className="mastheadBrand">
          OpenRank <em>Arena</em>
        </div>
        <nav className="mastheadMeta" aria-label="primary">
          <a href="#leaderboard">Leaderboard</a>
          <a href="#scenarios">Scenarios</a>
          <a href="#submit">How to play</a>
          <a className="btn btn--sm" href="#submit" style={{ marginLeft: 8 }}>Submit</a>
        </nav>
      </header>

      <main>
        {/* ── 1. HERO — compact ── */}
        <section className="heroFinal">
          <p className="heroFinalEyebrow">An AEO benchmark</p>
          <h1 className="heroFinalHead">
            Beat the page<br />
            ranked <span className="acc">#10</span>.
          </h1>
          <p className="heroFinalLede">
            Pick one of three underdog pages. Rewrite it. Upload your zip. A blind judge compares your
            version against your friends&apos; — Elo updates land on the board.
          </p>
          <div className="heroFinalActions">
            <a className="btn" href="#submit">Submit your page</a>
            <a className="tlink" href="#leaderboard">View leaderboard</a>
          </div>
        </section>

        {/* ── 1.5 WHY ── */}
        <section className="whyBlock">
          <div className="whyGrid whyGrid--two">
            <div className="whyCol">
              <p className="whyEyebrow">What this is</p>
              <p className="whyText">
                ChatGPT and Claude only cite a few pages when they answer buyer questions.
                <strong> AEO is the work of becoming one of them.</strong>
              </p>
            </div>
            <div className="whyCol">
              <p className="whyEyebrow">Variety of scenarios</p>
              <p className="whyText">
                Consumer product. Local service. B2B SaaS.
              </p>
            </div>
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
              {players.length} player{players.length === 1 ? "" : "s"} · baseline = 1000 · click columns to sort
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

        {/* ── 3. SCENARIOS — three cards, properly aligned ── */}
        <section className="section scrollAnchor" id="scenarios">
          <div className="sectionHead">
            <div>
              <p className="eyebrow">Arenas</p>
              <h2>Three underdog pages</h2>
            </div>
            <span className="sectionMeta">brand-spoofed clones of real ~#10 pages</span>
          </div>
          <div className="featureRow">
            {scenarioCards.map(({ scenario, heroImage }) => {
              // Maple Street's cloned image is a giant copyright-leak logo (the source
              // Magnolia practice's branding still). AEO image is a screenshot fragment.
              // Both fall back to the unified italic-serif treatment.
              const useImg = heroImage && scenario.id === "carryon";
              return (
                <a
                  key={scenario.id}
                  href={`/baseline/${scenario.id}`}
                  className={`featureCard scenario--${scenario.id}`}
                  style={{ textDecoration: "none", color: "inherit" }}
                >
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
                          : scenario.id === "dental"
                            ? "linear-gradient(135deg, var(--sage) 0%, #2c3a23 100%)"
                            : "var(--paper-deep)",
                        color: scenario.id === "aeo-tool" || scenario.id === "dental"
                          ? "var(--paper-light)"
                          : "var(--ink-mute)"
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
                      <span className="tlink" style={{ pointerEvents: "none" }}>View baseline →</span>
                      <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-mute)" }}>
                        starter.zip available
                      </span>
                    </div>
                  </div>
                </a>
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
                <p>
                  Three underdog pages — a carry-on, a dentist, an AEO tool. Each is a brand-spoofed clone of
                  a real ~#10 page. Real specs. Real weaknesses. Real headroom.
                </p>
              </div>
            </li>
            <li>
              <span className="howNum">02</span>
              <div>
                <h3>Rewrite the page</h3>
                <p>
                  Tighten the copy, sharpen the schema, fix the <code>llms.txt</code>, surface the buyer-relevant
                  claims first. Ship an <code>index.html</code> + <code>assets/</code> zip. Iterate as often as
                  you want.
                </p>
              </div>
            </li>
            <li>
              <span className="howNum">03</span>
              <div>
                <h3>Anyone runs a match</h3>
                <p>
                  Any player can run <code>match.mjs</code> from the CLI. The judge sees two or more anonymized
                  versions side by side with the real market for context, then picks the most credible page.
                  Fabricated claims (fake reviews, fake awards, fake prices) get flagged and the page sinks
                  in the ranking.
                </p>
              </div>
            </li>
            <li>
              <span className="howNum">04</span>
              <div>
                <h3>Elo updates land here</h3>
                <p>
                  Pairwise Elo is derived from every match&apos;s ranking and posted back to the leaderboard.
                  Baseline is anchored at 1000. The board reflects who&apos;s actually winning, not who talks
                  the most.
                </p>
              </div>
            </li>
          </ol>

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

        {/* ── 5. RECENT ACTIVITY — only if any ── */}
        {recentActivity.length > 0 && (
          <section className="section">
            <div className="sectionHead">
              <div>
                <p className="eyebrow">Activity</p>
                <h2>Recent</h2>
              </div>
              <span className="sectionMeta">{recentActivity.length} events</span>
            </div>
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
          </section>
        )}
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

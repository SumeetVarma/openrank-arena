import { notFound } from "next/navigation";
import { Redis } from "@upstash/redis";
import { getPlayer, getLatestSubmission, listSubmissionVersions } from "../../../lib/storage.mjs";
import { scenarioList } from "../../../lib/scenarios.mjs";
import { getEloFor, getDuelsFor, BASELINE_NAME, SEED_ELO } from "../../../lib/elo.mjs";

const HAS_KV = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
const redis = HAS_KV
  ? new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN
    })
  : null;

export async function generateMetadata({ params }) {
  const { name } = await params;
  return {
    title: `${name} · OpenRank Arena`,
    description: `${name}'s submissions and Elo standings across the OpenRank Arena scenarios.`
  };
}

function Avatar({ name, size = 64 }) {
  const initial = (name || "?").slice(0, 1).toUpperCase();
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "var(--ink)",
        color: "var(--paper-light)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--font-display)",
        fontWeight: 500,
        fontSize: size * 0.42,
        fontVariationSettings: '"opsz" 96, "SOFT" 30'
      }}
    >
      {initial}
    </span>
  );
}

export default async function PlayerProfile({ params }) {
  const { name } = await params;
  const player = await getPlayer(name);
  if (!player) return notFound();

  const summaries = await Promise.all(
    scenarioList.map(async (s) => {
      const latest = await getLatestSubmission(name, s.id);
      const versions = await listSubmissionVersions(name, s.id);
      const elo = await getEloFor(redis, name, s.id);
      const duels = await getDuelsFor(redis, name, s.id);
      return { scenario: s, latest, versions, elo, duels };
    })
  );

  const overallElo = summaries.filter((s) => s.duels > 0).length
    ? Math.round(
        summaries.filter((s) => s.duels > 0).reduce((acc, s) => acc + s.elo, 0) /
          summaries.filter((s) => s.duels > 0).length
      )
    : SEED_ELO;

  const scenariosPlayed = summaries.filter((s) => s.latest).length;
  const totalDuels = summaries.reduce((acc, s) => acc + s.duels, 0);

  return (
    <div className="siteFrame">
      <header className="masthead">
        <div className="mastheadBrand">
          <a href="/" style={{ color: "inherit" }}>OpenRank <em>Arena</em></a>
        </div>
        <nav className="mastheadMeta" aria-label="primary">
          <a href="/#leaderboard">leaderboard</a>
          <a href="/#scenarios">scenarios</a>
          <a href="/#start">join</a>
          <a href="/submit">submit</a>
        </nav>
      </header>

      <main>
        <section className="hero">
          <div>
            <p className="eyebrow">Player profile</p>
            <div style={{ display: "flex", alignItems: "center", gap: 24, marginBottom: 24 }}>
              <Avatar name={player.name} size={88} />
              <div>
                <h1
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 400,
                    fontSize: "clamp(48px, 6vw, 88px)",
                    letterSpacing: "-0.025em",
                    lineHeight: 1,
                    fontVariationSettings: '"opsz" 144, "SOFT" 30'
                  }}
                >
                  {player.name}
                </h1>
                <p
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    textTransform: "uppercase",
                    letterSpacing: "0.16em",
                    color: "var(--ink-mute)",
                    marginTop: 8
                  }}
                >
                  Joined {new Date(player.joinedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                </p>
              </div>
            </div>
          </div>

          <dl className="heroNumbers">
            <div className="heroNumber">
              <dt>Overall Elo</dt>
              <dd className="tnum">{overallElo}</dd>
            </div>
            <div className="heroNumber">
              <dt>Scenarios played</dt>
              <dd className="tnum">{scenariosPlayed} / {scenarioList.length}</dd>
            </div>
            <div className="heroNumber">
              <dt>Duels logged</dt>
              <dd className="tnum">{totalDuels}</dd>
            </div>
          </dl>
        </section>

        <section className="section">
          <div className="sectionHead">
            <div>
              <p className="eyebrow">Submissions</p>
              <h2>Across the three scenarios.</h2>
            </div>
            <span className="sectionMeta">Latest version is what duels</span>
          </div>

          <div className="scenarioStack">
            {summaries.map(({ scenario, latest, versions, elo, duels }) => (
              <article className={`scenarioBlock scenario--${scenario.id}`} key={scenario.id}>
                <div className="scenarioGlyph" aria-hidden="true">
                  {scenario.id === "carryon" ? "f₄₂" : scenario.id === "dental" ? "M" : "&"}
                </div>

                <div className="scenarioMain">
                  <span className="scenarioTag">{scenario.category}</span>
                  <h3>{scenario.label}</h3>

                  {latest ? (
                    <>
                      <p style={{ fontSize: 15, color: "var(--ink-soft)", marginBottom: 12 }}>
                        Latest <span className="mono">v{latest.version}</span> · uploaded{" "}
                        {new Date(latest.uploadedAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit"
                        })}
                      </p>
                      {latest.note && (
                        <p
                          className="serifItalic"
                          style={{
                            fontSize: 17,
                            color: "var(--ink-soft)",
                            borderLeft: "2px solid var(--ember)",
                            paddingLeft: 12,
                            marginBottom: 16
                          }}
                        >
                          &ldquo;{latest.note}&rdquo;
                        </p>
                      )}
                      <div className="scenarioActions">
                        <a className="tlink" href={`/players/${name}/${scenario.id}`}>view latest</a>
                        <a className="tlink" href={`/players/${name}/${scenario.id}/source.zip`}>download zip</a>
                        <a className="tlink" href={`/baseline/${scenario.id}`}>compare baseline</a>
                      </div>
                    </>
                  ) : (
                    <p
                      className="serifItalic"
                      style={{
                        fontSize: 18,
                        color: "var(--ink-mute)",
                        fontStyle: "italic",
                        marginBottom: 16
                      }}
                    >
                      No submission for this scenario yet.{" "}
                      <a className="tlink" href="/submit" style={{ marginLeft: 8 }}>Upload one</a>
                    </p>
                  )}
                </div>

                <aside className="scenarioAside">
                  <div>
                    <div className="scenarioAsideTitle">Standing</div>
                    <div
                      style={{
                        fontFamily: "var(--font-display)",
                        fontWeight: 400,
                        fontSize: 36,
                        letterSpacing: "-0.02em",
                        fontVariantNumeric: "tabular-nums",
                        color: duels > 0 ? "var(--ember)" : "var(--ink-mute)",
                        lineHeight: 1
                      }}
                    >
                      {Math.round(elo)}
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: "0.14em",
                        color: "var(--ink-mute)",
                        marginTop: 4
                      }}
                    >
                      {duels === 0 ? "unranked" : `${duels} duel${duels === 1 ? "" : "s"}`}
                    </div>
                  </div>
                  {versions.length > 1 && (
                    <div>
                      <div className="scenarioAsideTitle">Version history</div>
                      <ul className="miniBoardList">
                        {versions.slice(0, 5).map((v) => (
                          <li key={v.version} className="miniBoardRow">
                            <span className="name">
                              <a href={`/players/${name}/${scenario.id}/v/${v.version}`}>v{v.version}</a>
                            </span>
                            <span className="elo">
                              {new Date(v.uploadedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                            </span>
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
      </main>

      <footer className="siteFoot">
        <span>OpenRank Arena</span>
        <a className="tlink" href="/">← back to arena</a>
      </footer>
    </div>
  );
}

import { notFound } from "next/navigation";
import { getPlayer, getLatestSubmission, listSubmissionVersions } from "../../../lib/storage.mjs";
import { scenarioList } from "../../../lib/scenarios.mjs";

export async function generateMetadata({ params }) {
  const { name } = await params;
  return { title: `${name} — OpenRank Arena`, description: `${name}'s submissions` };
}

export default async function PlayerProfile({ params }) {
  const { name } = await params;
  const player = await getPlayer(name);
  if (!player) return notFound();

  const summaries = await Promise.all(
    scenarioList.map(async (s) => {
      const latest = await getLatestSubmission(name, s.id);
      const versions = await listSubmissionVersions(name, s.id);
      return { scenario: s, latest, versionCount: versions.length };
    })
  );

  return (
    <main>
      <section className="hero">
        <div className="heroCopy">
          <p className="eyebrow">Player profile</p>
          <h1>{player.name}</h1>
          <p>Joined {new Date(player.joinedAt).toLocaleDateString()}.</p>
        </div>
      </section>

      <section>
        <div className="sectionHead">
          <div>
            <p className="eyebrow">Submissions</p>
            <h2>Across scenarios</h2>
          </div>
          <span>{summaries.filter((x) => x.latest).length} scenarios played</span>
        </div>
        <div className="cards">
          {summaries.map(({ scenario, latest, versionCount }) => (
            <article className="card" key={scenario.id}>
              <p className="tag">{scenario.category}</p>
              <h3>{scenario.label}</h3>
              {latest ? (
                <>
                  <p className="small">
                    Latest v{latest.version} · {new Date(latest.uploadedAt).toLocaleString()}
                  </p>
                  {latest.note && <p>{latest.note}</p>}
                  <p>
                    <a href={`/players/${name}/${scenario.id}`}>View page →</a>
                  </p>
                  <p className="small">{versionCount} version{versionCount === 1 ? "" : "s"} on file</p>
                </>
              ) : (
                <>
                  <p className="small">No submission yet.</p>
                  <p>
                    <a href="/submit">Submit a page →</a>
                  </p>
                </>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

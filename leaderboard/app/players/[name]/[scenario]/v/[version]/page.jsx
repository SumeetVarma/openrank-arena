import { notFound } from "next/navigation";
import { getScenario } from "../../../../../../lib/scenarios.mjs";
import {
  getSubmissionVersion,
  verifySubmissionPassword
} from "../../../../../../lib/storage.mjs";
import { loadSubmissionAssets } from "../../../../../../lib/submissionAssets.mjs";

export default async function PlayerScenarioVersionPage({ params, searchParams }) {
  const { name, scenario: scenarioId, version } = await params;
  const { pw } = (await searchParams) || {};
  const scenario = getScenario(scenarioId);
  if (!scenario) return notFound();

  const submission = await getSubmissionVersion(name, scenarioId, version);
  if (!submission) return notFound();

  if (!verifySubmissionPassword(submission, pw)) {
    return (
      <main className="renderedPage">
        <article className="renderedArticle">
          <h1>Password required</h1>
          <form method="get">
            <input name="pw" type="password" placeholder="Enter password" />
            <button type="submit">View</button>
          </form>
        </article>
      </main>
    );
  }

  const assets = await loadSubmissionAssets(submission.blobPath);
  const html = assets.html || "<p>Submission did not include an <code>index.html</code>.</p>";

  return (
    <main className="renderedPage">
      <nav className="renderedNav">
        <a href={`/players/${name}/${scenarioId}`}>← latest</a>
        <span className="renderedBadge">
          {name} · {scenario.label} · v{version} (history)
        </span>
      </nav>
      <article className="renderedArticle" dangerouslySetInnerHTML={{ __html: html }} />
    </main>
  );
}

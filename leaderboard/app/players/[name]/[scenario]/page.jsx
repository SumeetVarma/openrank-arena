import { notFound } from "next/navigation";
import { getScenario } from "../../../../lib/scenarios.mjs";
import {
  getLatestSubmission,
  listSubmissionVersions,
  verifySubmissionPassword
} from "../../../../lib/storage.mjs";
import { loadSubmissionAssets } from "../../../../lib/submissionAssets.mjs";
import { splitSubmittedHtml } from "../../../../lib/submissionHtml.mjs";

export async function generateMetadata({ params }) {
  const { name, scenario: scenarioId } = await params;
  const scenario = getScenario(scenarioId);
  if (!scenario) return {};
  // Try to extract title and description from the player's submitted HTML
  // so their AEO-tuned <head> tags actually land in <head>.
  try {
    const submission = await getLatestSubmission(name, scenarioId);
    if (submission) {
      const assets = await loadSubmissionAssets(submission.blobPath);
      if (assets.html) {
        const titleMatch = assets.html.match(/<title>([\s\S]*?)<\/title>/i);
        const descMatch = assets.html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
        const ogTitle = assets.html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
        const ogDesc = assets.html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
        return {
          title: titleMatch ? titleMatch[1].trim() : `${name} — ${scenario.label}`,
          description: descMatch ? descMatch[1] : `${name}'s submission for the ${scenario.label} scenario.`,
          openGraph: {
            title: ogTitle ? ogTitle[1] : (titleMatch ? titleMatch[1].trim() : name),
            description: ogDesc ? ogDesc[1] : descMatch?.[1] || scenario.label
          }
        };
      }
    }
  } catch {
    // fall through
  }
  return {
    title: `${name} — ${scenario.label}`,
    description: `${name}'s submission for the ${scenario.label} scenario.`
  };
}

export default async function PlayerScenarioPage({ params, searchParams }) {
  const { name, scenario: scenarioId } = await params;
  const { pw } = (await searchParams) || {};
  const scenario = getScenario(scenarioId);
  if (!scenario) return notFound();

  const submission = await getLatestSubmission(name, scenarioId);
  const versions = await listSubmissionVersions(name, scenarioId);

  if (!submission) {
    return (
      <main className="renderedPage">
        <nav className="renderedNav">
          <a href="/">← OpenRank Arena</a>
          <span className="renderedBadge">{name} · {scenario.label}</span>
        </nav>
        <article className="renderedArticle">
          <h1>No submission yet</h1>
          <p>
            {name} has not submitted a page for the <strong>{scenario.label}</strong> scenario.
          </p>
          <p>
            <a href="/submit">Submit a page →</a>
          </p>
        </article>
      </main>
    );
  }

  if (!verifySubmissionPassword(submission, pw)) {
    return (
      <main className="renderedPage">
        <nav className="renderedNav">
          <a href="/">← OpenRank Arena</a>
          <span className="renderedBadge">Password required</span>
        </nav>
        <article className="renderedArticle">
          <h1>Password required</h1>
          <p>This submission is password-protected.</p>
          <form method="get">
            <input name="pw" type="password" placeholder="Enter password" />
            <button type="submit">View</button>
          </form>
        </article>
      </main>
    );
  }

  let assets;
  try {
    assets = await loadSubmissionAssets(submission.blobPath);
  } catch (err) {
    return (
      <main className="renderedPage">
        <article className="renderedArticle">
          <h1>Could not load submission</h1>
          <p>{String(err.message || err)}</p>
        </article>
      </main>
    );
  }

  const { headTags, bodyHtml } = splitSubmittedHtml(
    assets.html || "<p>Submission did not include an <code>index.html</code>.</p>"
  );

  return (
    <main className="renderedPage">
      <nav className="renderedNav">
        <a href="/">← OpenRank Arena</a>
        <span className="renderedBadge">
          {name} · {scenario.label} · v{submission.version}
        </span>
        {versions.length > 1 && (
          <details className="versionsDropdown">
            <summary>{versions.length} versions</summary>
            <ul>
              {versions.map((v) => (
                <li key={v.version}>
                  <a href={`/players/${name}/${scenarioId}/v/${v.version}`}>
                    v{v.version} · {new Date(v.uploadedAt).toLocaleString()}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}
      </nav>
      {headTags.length > 0 && (
        <div
          style={{ display: "none" }}
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: headTags.join("\n") }}
        />
      )}
      <article className="renderedArticle" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
    </main>
  );
}

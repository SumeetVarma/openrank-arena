import { notFound } from "next/navigation";
import { getScenario } from "../../../../lib/scenarios.mjs";
import {
  getLatestSubmission,
  listSubmissionVersions,
  verifySubmissionPassword
} from "../../../../lib/storage.mjs";
import { loadSubmissionAssets } from "../../../../lib/submissionAssets.mjs";
import { parseSubmittedHtml } from "../../../../lib/submissionHtml.mjs";

export async function generateMetadata({ params }) {
  const { name, scenario: scenarioId } = await params;
  const scenario = getScenario(scenarioId);
  if (!scenario) return {};
  try {
    const submission = await getLatestSubmission(name, scenarioId);
    if (submission) {
      const assets = await loadSubmissionAssets(submission.blobPath);
      if (assets.html) {
        const { metadata } = parseSubmittedHtml(assets.html);
        return buildNextMetadata(metadata, { name, scenario });
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

  const { jsonLd, bodyHtml } = parseSubmittedHtml(
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
      <article className="renderedArticle" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
      {jsonLd.map((j, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: j }}
        />
      ))}
    </main>
  );
}

function buildNextMetadata(meta, { name, scenario }) {
  const title = meta.title || `${name} — ${scenario.label}`;
  const description = meta.description || `${name}'s submission for the ${scenario.label} scenario.`;

  // The arena owns identity for this URL — never let player-supplied canonical
  // or og:url point at an external domain. Constrain to the arena path.
  const arenaCanonical = `/players/${name}/${scenario.id}`;
  const arenaUrl = `https://openrank-arena.vercel.app${arenaCanonical}`;

  const next = { title, description, alternates: { canonical: arenaCanonical } };

  if (meta.keywords) next.keywords = meta.keywords;
  if (meta.robots) next.robots = meta.robots;
  if (meta.authors || meta.author) next.authors = [{ name: meta.author }];

  const og = meta.og || {};
  if (og.title || og.description || og.image || og.url) {
    // Only keep og:image if it's a same-origin or arena-hosted URL.
    const safeImage = og.image && /^(https?:\/\/openrank-arena\.vercel\.app|\/)/.test(og.image) ? og.image : null;
    next.openGraph = {
      title: og.title || title,
      description: og.description || description,
      url: arenaUrl,
      siteName: "OpenRank Arena",
      type: og.type || "website",
      images: safeImage ? [{ url: safeImage }] : undefined
    };
  }

  const tw = meta.twitter || {};
  if (tw.card || tw.title || tw.description || tw.image) {
    // Same rule as og:image — only keep twitter:image if same-origin or arena-hosted.
    const safeTwImage = tw.image && /^(https?:\/\/openrank-arena\.vercel\.app|\/)/.test(tw.image) ? tw.image : null;
    next.twitter = {
      card: tw.card || "summary",
      title: tw.title || title,
      description: tw.description || description,
      // Drop player-controlled twitter:site / twitter:creator — the arena owns identity.
      images: safeTwImage ? [safeTwImage] : undefined
    };
  }

  return next;
}

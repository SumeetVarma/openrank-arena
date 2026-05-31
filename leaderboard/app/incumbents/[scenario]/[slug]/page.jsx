import { notFound } from "next/navigation";
import { getScenario, getCandidate } from "../../../../lib/scenarios.mjs";
import { readIncumbent, renderMarkdown, stripSourceNote } from "../../../../lib/baseline.mjs";
import { structuredDataFor } from "../../../../lib/structured.mjs";
import { readClonedIncumbent, splitClonedHtml, metaFromCloned } from "../../../../lib/clonedBaseline.mjs";

export async function generateMetadata({ params }) {
  const { scenario: scenarioId, slug } = await params;
  const scenario = getScenario(scenarioId);
  const candidate = scenario && getCandidate(scenarioId, slug);
  if (!candidate) return {};
  const cloned = await readClonedIncumbent(scenarioId, slug);
  if (cloned) {
    const m = metaFromCloned(cloned.html);
    return {
      title: m.title || `${candidate.name} — ${scenario.label}`,
      description: m.description,
      openGraph: m.openGraph,
      twitter: m.twitter,
      keywords: m.keywords
    };
  }
  return {
    title: `${candidate.name} — ${scenario.label}`,
    description: `Incumbent page for ${candidate.name} in the ${scenario.label} arena scenario.`,
    openGraph: { title: candidate.name, description: scenario.label, type: "website" },
    twitter: { card: "summary", title: candidate.name, description: scenario.label }
  };
}

export default async function IncumbentPage({ params }) {
  const { scenario: scenarioId, slug } = await params;
  const scenario = getScenario(scenarioId);
  const candidate = scenario && getCandidate(scenarioId, slug);
  if (!scenario || !candidate || candidate.kind !== "incumbent") return notFound();

  const cloned = await readClonedIncumbent(scenarioId, slug);
  if (cloned) {
    const { bodyHtml, jsonLd } = splitClonedHtml(cloned.html);
    const rewritten = bodyHtml.replace(
      /(["'])(?:\.\/)?assets\//g,
      `$1/incumbents/${scenarioId}/${slug}/assets/`
    );
    return (
      <main className="renderedPage">
        <nav className="renderedNav">
          <a href="/">← OpenRank Arena</a>
          <span className="renderedBadge">Incumbent · {scenario.label}</span>
        </nav>
        <article className="renderedArticle" dangerouslySetInnerHTML={{ __html: rewritten }} />
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

  // Fallback: markdown rendering
  const md = stripSourceNote(await readIncumbent(scenarioId, candidate.baselineFile));
  const html = renderMarkdown(md);
  const jsonLd = structuredDataFor(scenario, candidate);

  return (
    <main className="renderedPage">
      <nav className="renderedNav">
        <a href="/">← OpenRank Arena</a>
        <span className="renderedBadge">Incumbent · {scenario.label}</span>
      </nav>
      <article className="renderedArticle" dangerouslySetInnerHTML={{ __html: html }} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </main>
  );
}

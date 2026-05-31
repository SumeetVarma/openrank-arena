import { notFound } from "next/navigation";
import { getScenario, getCandidate } from "../../../../lib/scenarios.mjs";
import { readIncumbent, renderMarkdown, stripSourceNote } from "../../../../lib/baseline.mjs";
import { structuredDataFor } from "../../../../lib/structured.mjs";

export async function generateMetadata({ params }) {
  const { scenario: scenarioId, slug } = await params;
  const scenario = getScenario(scenarioId);
  const candidate = scenario && getCandidate(scenarioId, slug);
  if (!candidate) return {};
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

import { notFound } from "next/navigation";
import { getScenario } from "../../../lib/scenarios.mjs";
import { readUnderdog, renderMarkdown, stripSourceNote } from "../../../lib/baseline.mjs";
import { structuredDataFor } from "../../../lib/structured.mjs";

export async function generateMetadata({ params }) {
  const { scenario: scenarioId } = await params;
  const scenario = getScenario(scenarioId);
  if (!scenario) return {};
  const c = scenario.underdog;
  return {
    title: `${c.name} — ${scenario.label}`,
    description: `Baseline page for ${c.name}, the underdog in the ${scenario.label} arena scenario.`,
    openGraph: { title: c.name, description: scenario.label, type: "website" },
    twitter: { card: "summary", title: c.name, description: scenario.label }
  };
}

export default async function BaselinePage({ params }) {
  const { scenario: scenarioId } = await params;
  const scenario = getScenario(scenarioId);
  if (!scenario) return notFound();
  const md = stripSourceNote(await readUnderdog(scenarioId, scenario.underdog.baselineFile));
  const html = renderMarkdown(md);
  const jsonLd = structuredDataFor(scenario, scenario.underdog);

  return (
    <main className="renderedPage">
      <nav className="renderedNav">
        <a href="/">← OpenRank Arena</a>
        <span className="renderedBadge">Baseline · {scenario.label}</span>
      </nav>
      <article className="renderedArticle" dangerouslySetInnerHTML={{ __html: html }} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </main>
  );
}

import { notFound } from "next/navigation";
import { getScenario, getCandidate } from "../../../../lib/scenarios.mjs";
import { readIncumbent, renderMarkdown, stripSourceNote } from "../../../../lib/baseline.mjs";
import { structuredDataFor } from "../../../../lib/structured.mjs";
import { readClonedIncumbent, metaFromCloned } from "../../../../lib/clonedBaseline.mjs";
import { extractCloned } from "../../../../lib/clonedExtract.mjs";
import { RenderedPage } from "../../../_components/RenderedPage.jsx";

function cleanTitle(raw, brand) {
  if (!raw) return null;
  let t = raw.trim();
  const dupRe = new RegExp(`(${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\s*[–|—-]\\s*\\1`, "i");
  if (dupRe.test(t)) t = t.replace(dupRe, brand);
  return t;
}

export async function generateMetadata({ params }) {
  const { scenario: scenarioId, slug } = await params;
  const scenario = getScenario(scenarioId);
  const candidate = scenario && getCandidate(scenarioId, slug);
  if (!candidate) return {};
  const canonicalPath = `/incumbents/${scenarioId}/${slug}`;
  const cloned = await readClonedIncumbent(scenarioId, slug);
  if (cloned) {
    const m = metaFromCloned(cloned.html);
    return {
      title: cleanTitle(m.title, candidate.name) || `${candidate.name} — ${scenario.label}`,
      description: m.description,
      alternates: { canonical: canonicalPath },
      openGraph: m.openGraph,
      twitter: m.twitter,
      keywords: m.keywords
    };
  }
  return {
    title: `${candidate.name} — ${scenario.label}`,
    description: `Incumbent page for ${candidate.name} in the ${scenario.label} arena scenario.`,
    alternates: { canonical: canonicalPath }
  };
}

export default async function IncumbentPage({ params }) {
  const { scenario: scenarioId, slug } = await params;
  const scenario = getScenario(scenarioId);
  const candidate = scenario && getCandidate(scenarioId, slug);
  if (!scenario || !candidate || candidate.kind !== "incumbent") return notFound();

  const cloned = await readClonedIncumbent(scenarioId, slug);
  if (cloned) {
    const data = extractCloned(cloned.html, {
      brandName: candidate.name,
      kind: "incumbent",
      localAssets: cloned.localAssets || []
    });
    const rewriteAssets = (src) => {
      if (!src) return src;
      if (src.startsWith("/")) return src;
      if (src.startsWith("assets/")) return `/incumbents/${scenarioId}/${slug}/${src}`;
      return src;
    };
    return (
      <RenderedPage
        scenario={scenario}
        data={data}
        kind="incumbent"
        name={candidate.name}
        rewriteAssets={rewriteAssets}
      />
    );
  }

  // Fallback: markdown rendering
  const md = stripSourceNote(await readIncumbent(scenarioId, candidate.baselineFile));
  const html = renderMarkdown(md);
  const jsonLd = structuredDataFor(scenario, candidate);
  return (
    <div className="renderedShell">
      <div className="renderedTopBar">
        <a href="/">← OpenRank Arena</a>
        <span>Incumbent · {scenario.label}</span>
      </div>
      <article className="productSectionBody" dangerouslySetInnerHTML={{ __html: html }} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </div>
  );
}

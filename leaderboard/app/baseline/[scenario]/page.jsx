import { notFound } from "next/navigation";
import { getScenario } from "../../../lib/scenarios.mjs";
import { readUnderdog, renderMarkdown, stripSourceNote } from "../../../lib/baseline.mjs";
import { structuredDataFor } from "../../../lib/structured.mjs";
import { readClonedUnderdog, metaFromCloned } from "../../../lib/clonedBaseline.mjs";
import { extractCloned } from "../../../lib/clonedExtract.mjs";
import { RenderedPage } from "../../_components/RenderedPage.jsx";

function cleanTitle(raw, brand) {
  if (!raw) return null;
  let t = raw.trim();
  const dupRe = new RegExp(`(${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\s*[–|—-]\\s*\\1`, "i");
  if (dupRe.test(t)) t = t.replace(dupRe, brand);
  return t;
}

export async function generateMetadata({ params }) {
  const { scenario: scenarioId } = await params;
  const scenario = getScenario(scenarioId);
  if (!scenario) return {};
  const cloned = await readClonedUnderdog(scenarioId, scenario.underdog.slug);
  const canonicalPath = `/baseline/${scenarioId}`;
  if (cloned) {
    const m = metaFromCloned(cloned.html);
    return {
      title: cleanTitle(m.title, scenario.underdog.name) || `${scenario.underdog.name} — ${scenario.label}`,
      description: m.description || `Baseline page for ${scenario.underdog.name}.`,
      alternates: { canonical: canonicalPath },
      openGraph: m.openGraph,
      twitter: m.twitter,
      keywords: m.keywords
    };
  }
  const c = scenario.underdog;
  return {
    title: `${c.name} — ${scenario.label}`,
    description: `Baseline page for ${c.name}, the underdog in the ${scenario.label} arena scenario.`,
    alternates: { canonical: canonicalPath }
  };
}

export default async function BaselinePage({ params }) {
  const { scenario: scenarioId } = await params;
  const scenario = getScenario(scenarioId);
  if (!scenario) return notFound();

  const cloned = await readClonedUnderdog(scenarioId, scenario.underdog.slug);

  if (cloned) {
    const data = extractCloned(cloned.html, {
      brandName: scenario.underdog.name,
      kind: "underdog",
      localAssets: cloned.localAssets || []
    });
    // Rewrite "assets/foo.jpg" to absolute URL on the baseline route
    const rewriteAssets = (src) => {
      if (!src) return src;
      if (src.startsWith("/")) return src;
      if (src.startsWith("assets/")) return `/baseline/${scenarioId}/${src}`;
      return src;
    };
    return (
      <RenderedPage
        scenario={scenario}
        data={data}
        kind="underdog"
        name={scenario.underdog.name}
        rewriteAssets={rewriteAssets}
      />
    );
  }

  // Fallback: markdown rendering for scenarios without a clone (shouldn't happen now)
  const md = stripSourceNote(await readUnderdog(scenarioId, scenario.underdog.baselineFile));
  const html = renderMarkdown(md);
  const jsonLd = structuredDataFor(scenario, scenario.underdog);
  return (
    <div className="renderedShell">
      <div className="renderedTopBar">
        <a href="/">← OpenRank Arena</a>
        <span>Baseline · {scenario.label}</span>
      </div>
      <article className="productSectionBody" dangerouslySetInnerHTML={{ __html: html }} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </div>
  );
}

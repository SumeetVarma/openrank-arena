// Build a starter zip for a scenario from the baseline markdown.
// Used by:
//   1. /baseline/[scenario]/starter.zip — downloadable starter for offline editing
//   2. /api/start — one-click "clone baseline as my v1" to create an instant submission
//
// The starter zip contains:
//   - index.html  (rendered from baseline markdown, with prefilled <head> tags + JSON-LD)
//   - llms.txt    (auto-generated from baseline markdown)
//   - README.txt  (one-paragraph "how to iterate" note)

import JSZip from "jszip";
import { readUnderdog, renderMarkdown, stripSourceNote } from "./baseline.mjs";
import { llmsTxtFromMarkdown } from "./llmstxt.mjs";
import { structuredDataFor } from "./structured.mjs";

export async function buildStarterZip(scenario) {
  const md = stripSourceNote(await readUnderdog(scenario.id, scenario.underdog.baselineFile));
  const bodyHtml = renderMarkdown(md);
  const llmsTxt = llmsTxtFromMarkdown(md, {
    name: scenario.underdog.name,
    kind: "underdog",
    scenario
  });
  const jsonLd = structuredDataFor(scenario, scenario.underdog);

  const title = scenario.underdog.name;
  const description = `${scenario.underdog.name} — baseline page for the "${scenario.label}" arena scenario. Your starting point: rewrite and optimize from here.`;

  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escape(title)}</title>
  <meta name="description" content="${escape(description)}">
  <meta name="robots" content="index, follow">
  <meta property="og:title" content="${escape(title)}">
  <meta property="og:description" content="${escape(description)}">
  <meta property="og:type" content="website">
  <script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
  </script>
</head>
<body>
${bodyHtml}
</body>
</html>
`;

  const readme = `Welcome to your starter for "${scenario.label}".

This zip is the unmodified baseline — your starting point. You can:
1. Edit index.html: rewrite copy, restructure sections, tighten headings, add an FAQ.
2. Edit llms.txt: make the AI crawler summary tighter and more buyer-relevant.
3. Drop images into an assets/ folder (use real alt text!).
4. Edit the JSON-LD in <head> to add more schema.org claims (use only true ones).
5. Re-zip the folder contents and upload via /submit. Every upload is a new version.

Buyer query to optimize for: "${scenario.buyerQuery}"

Rules: no fabricated prices, ratings, awards, integrations, or features. The judge flags fabrications; fabricating about your own page caps your score at 0.5.
`;

  const zip = new JSZip();
  zip.file("index.html", indexHtml);
  zip.file("llms.txt", llmsTxt);
  zip.file("README.txt", readme);
  return await zip.generateAsync({ type: "nodebuffer" });
}

function escape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

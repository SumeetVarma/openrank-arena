// Build a starter zip for a scenario.
//
// Prefers the visually-cloned baseline (with real images + structured HTML),
// falls back to markdown rendering for any scenario without a clone.
//
// Used by:
//   1. /baseline/[scenario]/starter.zip — downloadable starter for offline editing
//   2. /api/start — one-click "clone baseline as my v1" to create an instant submission

import JSZip from "jszip";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { readUnderdog, renderMarkdown, stripSourceNote } from "./baseline.mjs";
import { llmsTxtFromMarkdown } from "./llmstxt.mjs";
import { structuredDataFor } from "./structured.mjs";

const BASELINES_DIR = path.resolve(process.cwd(), "..", "baselines");

export async function buildStarterZip(scenario) {
  const zip = new JSZip();
  const cloneDir = path.join(BASELINES_DIR, "underdog-clone", scenario.id, scenario.underdog.slug);

  let indexHtml;
  let llmsTxt;
  let usedClone = false;

  try {
    indexHtml = await readFile(path.join(cloneDir, "index.html"), "utf8");
    llmsTxt = await readFile(path.join(cloneDir, "llms.txt"), "utf8");
    // Also include the assets folder verbatim so the player has real images to iterate on
    try {
      const assetsDir = path.join(cloneDir, "assets");
      const files = await readdir(assetsDir);
      for (const f of files) {
        const buf = await readFile(path.join(assetsDir, f));
        zip.file(`assets/${f}`, buf);
      }
    } catch {
      // no assets dir, that's fine
    }
    usedClone = true;
  } catch {
    // Fallback to markdown rendering
    const md = stripSourceNote(await readUnderdog(scenario.id, scenario.underdog.baselineFile));
    const bodyHtml = renderMarkdown(md);
    llmsTxt = llmsTxtFromMarkdown(md, {
      name: scenario.underdog.name,
      kind: "underdog",
      scenario
    });
    const jsonLd = structuredDataFor(scenario, scenario.underdog);
    const title = scenario.underdog.name;
    const description = `${scenario.underdog.name} — baseline page for the "${scenario.label}" arena scenario.`;
    indexHtml = `<!DOCTYPE html>
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
  }

  const readme = `╔══════════════════════════════════════════════════════════╗
║  Welcome to the AEO dojo, fellow underdog whisperer.     ║
╚══════════════════════════════════════════════════════════╝

You are now the proud(?) AEO operator for **${scenario.underdog.name}**.
Scenario: ${scenario.label}.
The buyer just walked in and asked an AI:

  "${scenario.buyerQuery}"

Your job: make ${scenario.underdog.name} the answer.
Without making things up.
Truth + structure > swagger. Schema > vibes.

What's in this zip
──────────────────
  index.html   the page itself (${usedClone ? "real cloned source, brand-spoofed" : "markdown-rendered"})
  llms.txt     a clean summary AI crawlers fetch
  ${usedClone ? "assets/      real product photos with descriptive alt text" : ""}

What to do
──────────
  1. Open index.html. Read it like an LLM would.
  2. Tighten the headings, restructure, surface the buyer-relevant claims first.
  3. Edit llms.txt — this is the AI-crawler love letter. Make it sing.
  4. Beef up JSON-LD in <head>. More true claims = more machine-readable wins.
  5. Don't fabricate. Fake awards/reviews/prices = ranking penalty.
  6. Re-zip the folder, upload via /submit. New version every time.

Goal
────
  Baseline Elo: 1000. Yours: 1000. Dream: 2000.
  Beat the incumbents. Beat your friends. Beat your past self.

May your structured data be plentiful and your fabrications few.

Now go.
`;

  zip.file("index.html", indexHtml);
  zip.file("llms.txt", llmsTxt);
  zip.file("README.txt", readme);
  return await zip.generateAsync({ type: "nodebuffer" });
}

function escape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

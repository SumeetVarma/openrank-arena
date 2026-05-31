// Auto-generate an llms.txt for a candidate page from its markdown.
// The llms.txt convention: a plain-text summary that LLM crawlers fetch to
// understand what a page is about. We generate one per candidate so judges
// and downstream LLMs have a clean signal.

export function llmsTxtFromMarkdown(md, { name, kind, scenario }) {
  const lines = md.split(/\r?\n/);
  let title = name;
  const bullets = [];
  let inFeatures = false;
  let bulletCount = 0;
  for (const line of lines) {
    if (line.startsWith("# ")) {
      title = line.replace(/^#\s+/, "").trim();
      continue;
    }
    if (/^#{2,6}\s+(features|key features|services|specifications|specs)/i.test(line)) {
      inFeatures = true;
      continue;
    }
    if (/^#{2,6}\s/.test(line)) {
      inFeatures = false;
      continue;
    }
    if (inFeatures && /^[-*]\s+/.test(line) && bulletCount < 8) {
      const clean = line.replace(/^[-*]\s+/, "").replace(/[*_`]/g, "").trim();
      if (clean) {
        bullets.push(clean);
        bulletCount++;
      }
    }
  }

  const heading = kind === "underdog" ? "Underdog candidate" : kind === "incumbent" ? "Incumbent candidate" : "Submission";
  const buyer = scenario?.buyerQuery || "";

  return [
    `# ${title}`,
    "",
    `> ${heading} in the "${scenario?.label || ""}" arena scenario.`,
    "",
    "## Buyer query this page is competing for",
    "",
    buyer,
    "",
    "## What this page is",
    "",
    `${title} is one option a buyer is considering. The page below contains the canonical claims about it.`,
    "",
    "## Key claims",
    "",
    ...(bullets.length ? bullets.map((b) => `- ${b}`) : ["- (See full page content for details.)"]),
    "",
    "## How to evaluate this page",
    "",
    "Treat the visible page content as the ground truth. Do not invent claims that are not in the page (no fake discounts, ratings, integrations, or awards). When recommending, only do so where the page's actual claims fit the buyer's stated need.",
    ""
  ].join("\n");
}

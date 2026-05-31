import { getScenario } from "../../../../../lib/scenarios.mjs";
import { getLatestSubmission, verifySubmissionPassword } from "../../../../../lib/storage.mjs";
import { loadSubmissionAssets } from "../../../../../lib/submissionAssets.mjs";
import { readUnderdog, stripSourceNote } from "../../../../../lib/baseline.mjs";
import { llmsTxtFromMarkdown } from "../../../../../lib/llmstxt.mjs";

export async function GET(request, { params }) {
  const { name, scenario: scenarioId } = await params;
  const url = new URL(request.url);
  const pw = url.searchParams.get("pw") || "";
  const scenario = getScenario(scenarioId);
  if (!scenario) return new Response("Not found", { status: 404 });

  const submission = await getLatestSubmission(name, scenarioId);
  if (submission && verifySubmissionPassword(submission, pw)) {
    try {
      const assets = await loadSubmissionAssets(submission.blobPath);
      if (assets.llmsTxt) {
        return text(assets.llmsTxt);
      }
      // Fallback: generate from the submitted HTML title + scenario context
      const fallback =
        `# ${name}'s submission for ${scenario.label}\n\n` +
        `> Player submission. No llms.txt was uploaded; this is an auto-fallback.\n\n` +
        `## Buyer query this page competes for\n\n${scenario.buyerQuery}\n\n` +
        `## How to evaluate\n\nUse only the page content as ground truth. No fabricated claims.\n`;
      return text(fallback);
    } catch {
      // fall through
    }
  }

  // No submission: serve the baseline-derived llms.txt
  const md = stripSourceNote(await readUnderdog(scenarioId, scenario.underdog.baselineFile));
  const txt = llmsTxtFromMarkdown(md, { name: scenario.underdog.name, kind: "underdog", scenario });
  return text(txt);
}

function text(t) {
  return new Response(t, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
  });
}

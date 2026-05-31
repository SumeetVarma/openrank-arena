import { getScenario, getCandidate } from "../../../../../lib/scenarios.mjs";
import { readIncumbent, stripSourceNote } from "../../../../../lib/baseline.mjs";
import { llmsTxtFromMarkdown } from "../../../../../lib/llmstxt.mjs";

export async function GET(_request, { params }) {
  const { scenario: scenarioId, slug } = await params;
  const scenario = getScenario(scenarioId);
  const candidate = scenario && getCandidate(scenarioId, slug);
  if (!scenario || !candidate || candidate.kind !== "incumbent") {
    return new Response("Not found", { status: 404 });
  }
  const md = stripSourceNote(await readIncumbent(scenarioId, candidate.baselineFile));
  const txt = llmsTxtFromMarkdown(md, { name: candidate.name, kind: "incumbent", scenario });
  return new Response(txt, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" }
  });
}

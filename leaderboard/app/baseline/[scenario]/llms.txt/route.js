import { getScenario } from "../../../../lib/scenarios.mjs";
import { readUnderdog, stripSourceNote } from "../../../../lib/baseline.mjs";
import { llmsTxtFromMarkdown } from "../../../../lib/llmstxt.mjs";

export async function GET(_request, { params }) {
  const { scenario: scenarioId } = await params;
  const scenario = getScenario(scenarioId);
  if (!scenario) return new Response("Not found", { status: 404 });
  const md = stripSourceNote(await readUnderdog(scenarioId, scenario.underdog.baselineFile));
  const txt = llmsTxtFromMarkdown(md, { name: scenario.underdog.name, kind: "underdog", scenario });
  return new Response(txt, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" }
  });
}

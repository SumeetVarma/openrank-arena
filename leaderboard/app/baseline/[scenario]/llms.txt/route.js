import { getScenario } from "../../../../lib/scenarios.mjs";
import { readUnderdog, stripSourceNote } from "../../../../lib/baseline.mjs";
import { llmsTxtFromMarkdown } from "../../../../lib/llmstxt.mjs";
import { readClonedUnderdog } from "../../../../lib/clonedBaseline.mjs";

export async function GET(_request, { params }) {
  const { scenario: scenarioId } = await params;
  const scenario = getScenario(scenarioId);
  if (!scenario) return new Response("Not found", { status: 404 });

  // Prefer the llms.txt produced by the clone script.
  const cloned = await readClonedUnderdog(scenarioId, scenario.underdog.slug);
  if (cloned?.llmsTxt) {
    return text(cloned.llmsTxt);
  }

  const md = stripSourceNote(await readUnderdog(scenarioId, scenario.underdog.baselineFile));
  const txt = llmsTxtFromMarkdown(md, { name: scenario.underdog.name, kind: "underdog", scenario });
  return text(txt);
}

function text(t) {
  return new Response(t, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" }
  });
}

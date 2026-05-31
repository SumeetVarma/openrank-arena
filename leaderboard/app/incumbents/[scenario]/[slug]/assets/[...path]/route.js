import { getScenario, getCandidate } from "../../../../../../lib/scenarios.mjs";
import { readClonedAsset } from "../../../../../../lib/clonedBaseline.mjs";
import { mimeFor } from "../../../../../../lib/submissionAssets.mjs";

export const runtime = "nodejs";

export async function GET(_request, { params }) {
  const { scenario: scenarioId, slug, path } = await params;
  const scenario = getScenario(scenarioId);
  const candidate = scenario && getCandidate(scenarioId, slug);
  if (!scenario || !candidate || candidate.kind !== "incumbent") {
    return new Response("Not found", { status: 404 });
  }
  const rel = `assets/${path.join("/")}`;
  const buf = await readClonedAsset("incumbent", scenarioId, slug, rel);
  if (!buf) return new Response("Not found", { status: 404 });
  return new Response(buf, {
    status: 200,
    headers: { "Content-Type": mimeFor(rel), "Cache-Control": "public, max-age=86400" }
  });
}

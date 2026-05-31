// Serve cloned baseline assets (images, etc.) from baselines/underdog-clone/...
import { getScenario } from "../../../../../lib/scenarios.mjs";
import { readClonedAsset } from "../../../../../lib/clonedBaseline.mjs";
import { mimeFor } from "../../../../../lib/submissionAssets.mjs";

export const runtime = "nodejs";

export async function GET(_request, { params }) {
  const { scenario: scenarioId, path } = await params;
  const scenario = getScenario(scenarioId);
  if (!scenario) return new Response("Not found", { status: 404 });
  const rel = `assets/${path.join("/")}`;
  const buf = await readClonedAsset("underdog", scenarioId, scenario.underdog.slug, rel);
  if (!buf) return new Response("Not found", { status: 404 });
  return new Response(buf, {
    status: 200,
    headers: { "Content-Type": mimeFor(rel), "Cache-Control": "public, max-age=86400" }
  });
}

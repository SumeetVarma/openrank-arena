import { getScenario } from "../../../../lib/scenarios.mjs";
import { buildStarterZip } from "../../../../lib/starterZip.mjs";

export const runtime = "nodejs";

export async function GET(_request, { params }) {
  const { scenario: scenarioId } = await params;
  const scenario = getScenario(scenarioId);
  if (!scenario) return new Response("Not found", { status: 404 });
  const buffer = await buildStarterZip(scenario);
  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="openrank-arena-${scenarioId}-starter.zip"`,
      "Cache-Control": "no-store"
    }
  });
}

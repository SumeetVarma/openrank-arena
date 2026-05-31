// Download a player's submission zip directly, so other friends can inspect
// the exact HTML / llms.txt / JSON-LD they used. Encourages cross-learning.
//
// Honors per-submission password protection.

import {
  getLatestSubmission,
  verifySubmissionPassword,
  fetchZip
} from "../../../../../lib/storage.mjs";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const { name, scenario: scenarioId } = await params;
  const url = new URL(request.url);
  const pw = url.searchParams.get("pw") || "";
  const versionId = url.searchParams.get("v") || null;

  const submission = await getLatestSubmission(name, scenarioId);
  if (!submission) return new Response("No submission", { status: 404 });
  if (!verifySubmissionPassword(submission, pw)) {
    return new Response("Password required", { status: 401 });
  }

  let buffer;
  try {
    buffer = await fetchZip(submission.blobPath);
  } catch (err) {
    return new Response(`Failed to load submission: ${err.message}`, { status: 500 });
  }

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${name}-${scenarioId}-v${submission.version}.zip"`,
      "Cache-Control": "no-store"
    }
  });
}

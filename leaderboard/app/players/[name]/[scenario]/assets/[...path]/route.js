import { getLatestSubmission, verifySubmissionPassword } from "../../../../../../lib/storage.mjs";
import { loadSubmissionAssets, getAssetBuffer, mimeFor } from "../../../../../../lib/submissionAssets.mjs";

export async function GET(request, { params }) {
  const { name, scenario: scenarioId, path } = await params;
  const url = new URL(request.url);
  const pw = url.searchParams.get("pw") || "";
  const submission = await getLatestSubmission(name, scenarioId);
  if (!submission) return new Response("Not found", { status: 404 });
  if (!verifySubmissionPassword(submission, pw)) {
    return new Response("Password required", { status: 401 });
  }
  const assets = await loadSubmissionAssets(submission.blobPath);
  const relPath = `assets/${path.join("/")}`;
  const buffer = getAssetBuffer(assets, relPath);
  if (!buffer) return new Response("Not found", { status: 404 });
  return new Response(buffer, {
    status: 200,
    headers: { "Content-Type": mimeFor(relPath), "Cache-Control": "public, max-age=300" }
  });
}

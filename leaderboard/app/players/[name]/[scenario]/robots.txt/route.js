// Serve the player's robots.txt from their zip if included.
// Falls back to a permissive default so AEO crawlers (GPTBot, ClaudeBot,
// PerplexityBot, etc.) can read everything.

import { getLatestSubmission, verifySubmissionPassword } from "../../../../../lib/storage.mjs";
import { loadSubmissionAssets } from "../../../../../lib/submissionAssets.mjs";

export async function GET(request, { params }) {
  const { name, scenario: scenarioId } = await params;
  const url = new URL(request.url);
  const pw = url.searchParams.get("pw") || "";

  const submission = await getLatestSubmission(name, scenarioId);
  if (submission && verifySubmissionPassword(submission, pw)) {
    try {
      const assets = await loadSubmissionAssets(submission.blobPath);
      if (assets.robotsTxt) {
        return text(assets.robotsTxt);
      }
    } catch {
      // fall through
    }
  }

  // Default: permissive — AI crawlers welcome
  const fallback = [
    "# Default robots.txt for OpenRank Arena submission",
    "# Override by including a robots.txt in your submission zip.",
    "",
    "User-agent: *",
    "Allow: /",
    ""
  ].join("\n");
  return text(fallback);
}

function text(t) {
  return new Response(t, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
  });
}

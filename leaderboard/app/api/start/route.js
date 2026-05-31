// One-click: claim a player name and create a v1 submission seeded with the baseline.
// Goal: zero-friction first submission. No passwords on player name — anyone can
// use any name (5-friend trust). Per-submission privacy is handled separately.

import {
  ensurePlayer,
  appendSubmissionVersion,
  uploadZip
} from "../../../lib/storage.mjs";
import { getScenario } from "../../../lib/scenarios.mjs";
import { buildStarterZip } from "../../../lib/starterZip.mjs";
import crypto from "node:crypto";

export const runtime = "nodejs";

export async function POST(request) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "Invalid form body" }, 400);
  }

  const name = String(form.get("name") || "").trim();
  const scenario = String(form.get("scenario") || "");

  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    return json({ ok: false, error: "Invalid name (use letters, numbers, dash, underscore)" }, 400);
  }
  const s = getScenario(scenario);
  if (!s) return json({ ok: false, error: "Unknown scenario" }, 400);

  await ensurePlayer({ name });

  const buffer = await buildStarterZip(s);
  const version = crypto.randomBytes(4).toString("hex");
  const upload = await uploadZip({ name, scenario, version, buffer });

  const record = await appendSubmissionVersion({
    name,
    scenario,
    blobPath: upload.pathname,
    isPasswordProtected: false,
    submissionPassword: "",
    note: "auto-seeded from baseline"
  });

  const liveUrl = `/players/${name}/${scenario}`;

  // If the request came from a browser form (text/html accept header), redirect
  // to the live page so the user sees their submission immediately.
  const accept = request.headers.get("accept") || "";
  if (accept.includes("text/html")) {
    return Response.redirect(new URL(liveUrl, request.url), 303);
  }

  return json({
    ok: true,
    version: record.version,
    liveUrl,
    starterDownloadUrl: `/baseline/${scenario}/starter.zip`
  });
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

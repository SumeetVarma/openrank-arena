// Player submission upload. Accepts multipart/form-data with a zip file.
// No password on player name — anyone can submit under any name (5-friend
// trust). Per-submission privacy is opt-in via isPasswordProtected.

import {
  ensurePlayer,
  appendSubmissionVersion,
  uploadZip
} from "../../../lib/storage.mjs";
import { scenarios } from "../../../lib/scenarios.mjs";
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
  const zip = form.get("zip");
  const isPasswordProtected = form.get("isPasswordProtected") === "on";
  const submissionPassword = String(form.get("submissionPassword") || "");
  const note = String(form.get("note") || "");

  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    return json({ ok: false, error: "Invalid name" }, 400);
  }
  if (!scenarios[scenario]) {
    return json({ ok: false, error: "Unknown scenario" }, 400);
  }
  if (!zip || typeof zip === "string") {
    return json({ ok: false, error: "Zip file required" }, 400);
  }

  await ensurePlayer({ name });

  const buffer = Buffer.from(await zip.arrayBuffer());
  const version = crypto.randomBytes(4).toString("hex");
  const upload = await uploadZip({ name, scenario, version, buffer });

  const record = await appendSubmissionVersion({
    name,
    scenario,
    blobPath: upload.pathname,
    isPasswordProtected,
    submissionPassword,
    note
  });

  const liveUrl = `/players/${name}/${scenario}`;

  const accept = request.headers.get("accept") || "";
  if (accept.includes("text/html") && !accept.includes("application/json")) {
    return Response.redirect(new URL(liveUrl, request.url), 303);
  }

  return json({ ok: true, version: record.version, liveUrl });
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

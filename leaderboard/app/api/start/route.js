// One-click: claim a player name and create a v1 submission seeded with the baseline.
// Goal: zero-friction first submission. Player picks name + scenario, clicks button,
// has a live page they can immediately iterate on.

import {
  createPlayer,
  getPlayer,
  verifyPlayer,
  appendSubmissionVersion,
  uploadZip
} from "../../../lib/storage.mjs";
import { getScenario } from "../../../lib/scenarios.mjs";
import { buildStarterZip } from "../../../lib/starterZip.mjs";
import crypto from "node:crypto";

export const runtime = "nodejs";

export async function POST(request) {
  const form = await request.formData();
  const name = String(form.get("name") || "").trim();
  const password = String(form.get("password") || "");
  const scenario = String(form.get("scenario") || "");

  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    return json({ ok: false, error: "Invalid name (use letters, numbers, dash, underscore)" }, 400);
  }
  const s = getScenario(scenario);
  if (!s) return json({ ok: false, error: "Unknown scenario" }, 400);

  // Claim or verify
  const existing = await getPlayer(name);
  if (existing) {
    const ok = await verifyPlayer(name, password);
    if (!ok) return json({ ok: false, error: "Player name taken or wrong password" }, 401);
  } else {
    await createPlayer({ name, password });
  }

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

  return json({
    ok: true,
    version: record.version,
    liveUrl: `/players/${name}/${scenario}`,
    starterDownloadUrl: `/baseline/${scenario}/starter.zip`
  });
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

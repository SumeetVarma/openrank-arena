import {
  createPlayer,
  getPlayer,
  verifyPlayer,
  appendSubmissionVersion,
  uploadZip
} from "../../../lib/storage.mjs";
import { scenarios } from "../../../lib/scenarios.mjs";
import crypto from "node:crypto";

export const runtime = "nodejs";

export async function POST(request) {
  const form = await request.formData();
  const name = String(form.get("name") || "").trim();
  const password = String(form.get("password") || "");
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

  // Claim or verify player name
  const existing = await getPlayer(name);
  if (existing) {
    const ok = await verifyPlayer(name, password);
    if (!ok) return json({ ok: false, error: "Player name taken or wrong password" }, 401);
  } else {
    await createPlayer({ name, password });
  }

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
  return json({ ok: true, version: record.version, liveUrl });
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

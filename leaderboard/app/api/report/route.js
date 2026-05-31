import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function POST(request) {
  const payload = await request.json();
  const required = ["team", "score"];
  for (const field of required) {
    if (!payload[field]) {
      return Response.json({ error: `Missing ${field}` }, { status: 400 });
    }
  }

  if (process.env.REPORT_PASSWORD && payload.password !== process.env.REPORT_PASSWORD) {
    return Response.json({ error: "Invalid report password" }, { status: 401 });
  }

  const dataDir = path.join(process.cwd(), "data");
  const file = path.join(dataDir, "submissions.json");
  await mkdir(dataDir, { recursive: true });
  let rows = [];
  try {
    rows = JSON.parse(await readFile(file, "utf8"));
  } catch {
    rows = [];
  }

  const row = {
    team: String(payload.team).slice(0, 80),
    repo: payload.repo ? String(payload.repo).slice(0, 300) : "",
    score: Number(payload.score),
    notes: payload.notes ? String(payload.notes).slice(0, 500) : "",
    createdAt: new Date().toISOString()
  };

  rows.push(row);
  await writeFile(file, JSON.stringify(rows, null, 2));
  return Response.json({ ok: true, row });
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function POST(request) {
  const form = await request.formData();
  const password = String(form.get("password") || "");
  if (process.env.REPORT_PASSWORD && password !== process.env.REPORT_PASSWORD) {
    return new Response("Invalid shared password", { status: 401 });
  }

  const message = String(form.get("message") || "").trim();
  if (!message) {
    return new Response("Missing feedback message", { status: 400 });
  }

  const dataDir = path.join(process.cwd(), "data");
  const file = path.join(dataDir, "feedback.json");
  await mkdir(dataDir, { recursive: true });
  let rows = [];
  try {
    rows = JSON.parse(await readFile(file, "utf8"));
  } catch {
    rows = [];
  }

  rows.push({
    name: String(form.get("name") || "Anonymous").slice(0, 80),
    message: message.slice(0, 2000),
    createdAt: new Date().toISOString()
  });
  await writeFile(file, JSON.stringify(rows, null, 2));

  return new Response(
    `<!doctype html><html><body style="font-family: system-ui; padding: 40px;"><h1>Got it.</h1><p>Feedback saved. <a href="/">Back to leaderboard</a></p></body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}

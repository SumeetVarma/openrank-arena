// Feedback notes from the friend group. Writes to Redis so it persists on
// Vercel (the filesystem is read-only at runtime).

import { Redis } from "@upstash/redis";

export const runtime = "nodejs";

const HAS_KV = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
const redis = HAS_KV
  ? new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN
    })
  : null;

export async function POST(request) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return new Response("Invalid form body", { status: 400 });
  }

  const message = String(form.get("message") || "").trim();
  if (!message) {
    return new Response("Missing feedback message", { status: 400 });
  }

  const record = {
    name: String(form.get("name") || "Anonymous").slice(0, 80),
    message: message.slice(0, 2000),
    createdAt: new Date().toISOString()
  };

  if (redis) {
    // @upstash/redis serializes objects automatically — pass the record directly.
    await redis.lpush("feedback:all", record);
    await redis.ltrim("feedback:all", 0, 199);
  }

  // For form submits from the browser, redirect back to the home page.
  const accept = request.headers.get("accept") || "";
  if (accept.includes("text/html")) {
    return Response.redirect(new URL("/?note=ok", request.url), 303);
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

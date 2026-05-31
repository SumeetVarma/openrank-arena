// OpenAI provider. Reads OPENAI_API_KEY from env.

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o";

export async function call({ prompt, model = DEFAULT_MODEL, maxTokens = 2000 }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI ${res.status}: ${text}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  return { text, model, raw: data };
}

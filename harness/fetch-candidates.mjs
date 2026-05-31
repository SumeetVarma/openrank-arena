// Fetches the text content of every candidate page from the running leaderboard
// site. The judge consumes plain-text content (with tags stripped) so it
// behaves like an LLM crawler reading what's actually on the page.

const BASE = process.env.ARENA_BASE_URL || "http://localhost:3000";

export async function fetchCandidates({ scenario, playerNames }) {
  const candidates = [];

  // Underdog baseline
  candidates.push({
    slug: scenario.underdog.slug,
    kind: "underdog-baseline",
    source: `${BASE}/baseline/${scenario.id}`,
    content: await fetchAsText(`${BASE}/baseline/${scenario.id}`)
  });

  // Incumbents
  for (const inc of scenario.incumbents) {
    candidates.push({
      slug: inc.slug,
      kind: "incumbent",
      source: `${BASE}/incumbents/${scenario.id}/${inc.slug}`,
      content: await fetchAsText(`${BASE}/incumbents/${scenario.id}/${inc.slug}`)
    });
  }

  // Player submissions: each named player gets a candidate. Their submission
  // replaces the underdog baseline for purposes of scoring (it IS their
  // optimized version of the underdog). We mark slug as the player name so
  // the score lookup can find them.
  for (const name of playerNames) {
    const url = `${BASE}/players/${name}/${scenario.id}`;
    let content;
    try {
      content = await fetchAsText(url);
    } catch (err) {
      content = `Page failed to load: ${err.message}`;
    }
    candidates.push({
      slug: `player:${name}`,
      kind: "player",
      source: url,
      content
    });
  }

  return candidates;
}

async function fetchAsText(url) {
  const res = await fetch(url, { headers: { Accept: "text/html, text/plain" } });
  if (!res.ok) throw new Error(`Fetch ${url} -> ${res.status}`);
  const html = await res.text();
  return htmlToText(html);
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// Parse a submitted index.html into:
//   - structured metadata (title, description, OG, Twitter, robots, canonical, keywords)
//   - JSON-LD <script> blocks from <head>
//   - other raw <head> tags (link rel="preconnect", custom meta, etc.)
//   - the <body> inner HTML to render in the arena wrapper
//
// This is the AEO surface — the judge fetches the rendered page and we want
// EVERY signal the player put in their <head> to actually land in the
// document <head>, not get discarded.

export function parseSubmittedHtml(html) {
  if (!html) {
    return { metadata: {}, jsonLd: [], extraHeadTags: [], bodyHtml: "" };
  }

  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);

  let bodyHtml;
  if (bodyMatch) {
    bodyHtml = bodyMatch[1];
  } else {
    bodyHtml = headMatch ? html.replace(headMatch[0], "") : html;
  }

  const headInner = headMatch ? headMatch[1] : "";

  // ---- Structured metadata for generateMetadata() ----
  const metadata = {};
  const titleMatch = headInner.match(/<title>([\s\S]*?)<\/title>/i);
  if (titleMatch) metadata.title = titleMatch[1].trim();

  metadata.description = pickMeta(headInner, "name", "description");
  metadata.keywords = pickMeta(headInner, "name", "keywords");
  metadata.robots = pickMeta(headInner, "name", "robots");
  metadata.author = pickMeta(headInner, "name", "author");

  // Open Graph
  metadata.og = {
    title: pickMeta(headInner, "property", "og:title"),
    description: pickMeta(headInner, "property", "og:description"),
    image: pickMeta(headInner, "property", "og:image"),
    url: pickMeta(headInner, "property", "og:url"),
    type: pickMeta(headInner, "property", "og:type"),
    siteName: pickMeta(headInner, "property", "og:site_name")
  };

  // Twitter
  metadata.twitter = {
    card: pickMeta(headInner, "name", "twitter:card"),
    title: pickMeta(headInner, "name", "twitter:title"),
    description: pickMeta(headInner, "name", "twitter:description"),
    image: pickMeta(headInner, "name", "twitter:image"),
    site: pickMeta(headInner, "name", "twitter:site"),
    creator: pickMeta(headInner, "name", "twitter:creator")
  };

  // Canonical (link rel="canonical")
  const canonical = headInner.match(/<link\s+[^>]*rel=["']canonical["'][^>]*>/i);
  if (canonical) {
    const href = canonical[0].match(/href=["']([^"']+)["']/i);
    if (href) metadata.canonical = href[1];
  }

  // ---- JSON-LD scripts ----
  const jsonLd = [];
  const ldRe = /<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = ldRe.exec(headInner)) !== null) {
    jsonLd.push(m[1].trim());
  }
  // Also pick up JSON-LD scripts inside <body> (players sometimes put them there)
  const bodyLdRe = /<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = bodyLdRe.exec(bodyHtml)) !== null) {
    jsonLd.push(m[1].trim());
  }

  // ---- Other head tags we want to pass through (preconnect, dns-prefetch, etc.) ----
  const extraHeadTags = [];
  const linkRe = /<link\s+[^>]*>/gi;
  while ((m = linkRe.exec(headInner)) !== null) {
    const tag = m[0];
    // Skip canonical (already in metadata) and stylesheet (security)
    if (/rel=["'](canonical|stylesheet)["']/i.test(tag)) continue;
    extraHeadTags.push(tag);
  }

  return { metadata, jsonLd, extraHeadTags, bodyHtml };
}

// Kept for back-compat with earlier route code; new code should use parseSubmittedHtml.
export function splitSubmittedHtml(html) {
  const { metadata, jsonLd, extraHeadTags, bodyHtml } = parseSubmittedHtml(html);
  const headTags = [
    ...extraHeadTags,
    ...jsonLd.map((j) => `<script type="application/ld+json">${j}</script>`)
  ];
  return { headTags, bodyHtml, metadata };
}

// ---- helpers ----

function pickMeta(headInner, attr, key) {
  const re = new RegExp(
    `<meta\\s+[^>]*${attr}=["']${escapeRegex(key)}["'][^>]*content=["']([^"']+)["']`,
    "i"
  );
  const m1 = headInner.match(re);
  if (m1) return m1[1];
  // Also try with content before name/property
  const re2 = new RegExp(
    `<meta\\s+[^>]*content=["']([^"']+)["'][^>]*${attr}=["']${escapeRegex(key)}["']`,
    "i"
  );
  const m2 = headInner.match(re2);
  return m2 ? m2[1] : null;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

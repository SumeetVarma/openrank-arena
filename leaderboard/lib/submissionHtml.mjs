// Parse a submitted index.html into its <head> contents and <body> contents
// so the arena layout can render the player's body inside its own wrapper
// while still hoisting the player's <head> tags into the document head.

export function splitSubmittedHtml(html) {
  if (!html) return { headTags: [], bodyHtml: "" };

  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);

  let bodyHtml;
  if (bodyMatch) {
    bodyHtml = bodyMatch[1];
  } else {
    // No <body> tag — assume the entire string is body content (minus head)
    bodyHtml = headMatch ? html.replace(headMatch[0], "") : html;
  }

  const headInner = headMatch ? headMatch[1] : "";

  // Pull individual <meta>, <link>, <title>, <script type="application/ld+json"> tags.
  // Everything else from <head> is left alone (arena layout doesn't render arbitrary head content).
  const headTags = [];
  const tagRegexes = [
    /<title>[\s\S]*?<\/title>/gi,
    /<meta\b[^>]*\/?>/gi,
    /<link\b[^>]*\/?>/gi,
    /<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi
  ];
  for (const re of tagRegexes) {
    let m;
    while ((m = re.exec(headInner)) !== null) {
      headTags.push(m[0]);
    }
  }

  return { headTags, bodyHtml };
}

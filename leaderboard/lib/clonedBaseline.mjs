// Loader for the visually-cloned baseline pages produced by
// scripts/clone-baseline.mjs. Each page sits at
//   ../baselines/{underdog-clone|shared-clone}/<scenario>/<slug>/{index.html, llms.txt, assets/*}
//
// Returns null if no clone exists, in which case the caller falls back to the
// markdown-rendered baseline.

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const BASELINES_DIR = path.resolve(process.cwd(), "..", "baselines");

export async function readClonedUnderdog(scenarioId, slug) {
  return await tryLoad(path.join(BASELINES_DIR, "underdog-clone", scenarioId, slug));
}

export async function readClonedIncumbent(scenarioId, slug) {
  return await tryLoad(path.join(BASELINES_DIR, "shared-clone", scenarioId, slug));
}

export async function readClonedAsset(scope, scenarioId, slug, relPath) {
  // scope: "underdog" | "incumbent"
  const root =
    scope === "underdog"
      ? path.join(BASELINES_DIR, "underdog-clone", scenarioId, slug)
      : path.join(BASELINES_DIR, "shared-clone", scenarioId, slug);
  const clean = relPath.replace(/^\/+/, "").replace(/\.\./g, "");
  const target = path.join(root, clean);
  if (!target.startsWith(root)) return null;
  try {
    return await readFile(target);
  } catch {
    return null;
  }
}

async function tryLoad(dir) {
  try {
    const indexPath = path.join(dir, "index.html");
    await stat(indexPath);
    const html = await readFile(indexPath, "utf8");
    let llmsTxt = null;
    try {
      llmsTxt = await readFile(path.join(dir, "llms.txt"), "utf8");
    } catch {}
    return { html, llmsTxt, dir };
  } catch {
    return null;
  }
}

// Split the cloned full HTML into (a) <head> meta+JSON-LD we want to hoist,
// and (b) <body> innerHTML to render inside the arena wrapper.
export function splitClonedHtml(fullHtml) {
  const headMatch = fullHtml.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const bodyMatch = fullHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);

  const headInner = headMatch ? headMatch[1] : "";
  let bodyHtml = bodyMatch ? bodyMatch[1] : fullHtml;

  // Sanitize body for React hydration: remove tags that conflict with our
  // outer wrapper or that React can't safely hydrate inside a dangerouslySetInnerHTML.
  //   - <main>, <body>, <html>, <head>: nested at our wrapper level → invalid
  //   - <form>, <input>, <select>, <textarea>, <button>: interactive elements that
  //     React will fight to hydrate as static markup
  //   - <script>: anything except JSON-LD should be gone; client scripts blow up
  bodyHtml = bodyHtml
    // Strip these tags entirely (with content)
    .replace(/<(form|button|select|textarea)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    // Strip self-closing/void interactive tags
    .replace(/<(input|option)\b[^>]*\/?>/gi, "")
    // Unwrap (keep content, remove tags) for elements that shouldn't nest under <main>
    .replace(/<\/?(main|body|html|head)\b[^>]*>/gi, "")
    // Strip non-JSON-LD scripts (JSON-LD is preserved as parsed-out values)
    .replace(/<script\b(?![^>]*type=["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script>/gi, "")
    // Strip noscript and template — they confuse hydration
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, "")
    // Strip stray <link> from body
    .replace(/<link\b[^>]*\/?>/gi, "");

  // Extract structured tags from head
  const metaTags = [];
  const linkTags = [];
  const jsonLd = [];
  const titleMatch = headInner.match(/<title>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : null;

  for (const m of headInner.matchAll(/<meta\b[^>]*\/?>/gi)) metaTags.push(m[0]);
  for (const m of headInner.matchAll(/<link\b[^>]*\/?>/gi)) {
    if (!/rel=["']stylesheet["']/i.test(m[0])) linkTags.push(m[0]);
  }
  for (const m of headInner.matchAll(
    /<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    jsonLd.push(m[1].trim());
  }

  return { title, metaTags, linkTags, jsonLd, bodyHtml, headInner };
}

// Pull just the meta tags into a Next.js Metadata object for hoisting into <head>
export function metaFromCloned(fullHtml) {
  const { title, metaTags } = splitClonedHtml(fullHtml);
  const out = {};
  if (title) out.title = title;
  const get = (attr, key) => {
    const re = new RegExp(
      `<meta\\s+[^>]*${attr}=["']${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*content=["']([^"']+)["']`,
      "i"
    );
    for (const tag of metaTags) {
      const m = tag.match(re);
      if (m) return m[1];
      const re2 = new RegExp(
        `<meta\\s+[^>]*content=["']([^"']+)["'][^>]*${attr}=["']${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
        "i"
      );
      const m2 = tag.match(re2);
      if (m2) return m2[1];
    }
    return null;
  };
  const desc = get("name", "description");
  if (desc) out.description = desc;
  const keywords = get("name", "keywords");
  if (keywords) out.keywords = keywords;
  const ogTitle = get("property", "og:title");
  const ogDesc = get("property", "og:description");
  const ogImage = get("property", "og:image");
  const ogUrl = get("property", "og:url");
  const ogType = get("property", "og:type");
  if (ogTitle || ogDesc || ogImage) {
    out.openGraph = {
      title: ogTitle || undefined,
      description: ogDesc || undefined,
      url: ogUrl || undefined,
      type: ogType || "website",
      images: ogImage ? [{ url: ogImage }] : undefined
    };
  }
  const twCard = get("name", "twitter:card");
  const twTitle = get("name", "twitter:title");
  const twDesc = get("name", "twitter:description");
  const twImage = get("name", "twitter:image");
  if (twCard || twTitle || twDesc || twImage) {
    out.twitter = {
      card: twCard || "summary",
      title: twTitle || undefined,
      description: twDesc || undefined,
      images: twImage ? [twImage] : undefined
    };
  }
  return out;
}

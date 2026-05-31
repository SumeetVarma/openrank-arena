// Loader + sanitizer for the visually-cloned baseline pages produced by
// scripts/clone-baseline.mjs. Each page sits at
//   ../baselines/{underdog-clone|shared-clone}/<scenario>/<slug>/{index.html, llms.txt, assets/*}
//
// The cloned HTML comes from arbitrary e-commerce sites and contains lots of
// Shopify/Wordpress nondeterminism (Math.random() IDs, mismatched void tags,
// data-* spaghetti). Rendering it inside React's hydration model is fragile.
//
// Solution: use cheerio (real HTML parser) to walk the DOM and KEEP ONLY a
// small allowlist of presentation tags. Everything else gets unwrapped or
// dropped. Result: deterministic HTML React can hydrate without complaint.

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";

const BASELINES_DIR = path.resolve(process.cwd(), "..", "baselines");

// Tags we keep as-is (with attribute filtering, see below)
const ALLOWED_TAGS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "br", "hr",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
  "blockquote", "cite", "q",
  "strong", "b", "em", "i", "u", "mark", "small", "sub", "sup",
  "code", "pre", "kbd", "samp",
  "a", "img", "figure", "figcaption",
  "section", "article", "aside",
  "div", "span"
]);

// Attributes we keep (others stripped). Per-tag allowlists where it matters.
const GLOBAL_ALLOWED_ATTRS = new Set(["id", "lang", "dir", "title", "role"]);
const TAG_ATTR_RULES = {
  a: new Set(["href", "rel", "target"]),
  img: new Set(["src", "alt", "width", "height"]),
  table: new Set(["summary"]),
  th: new Set(["scope", "colspan", "rowspan"]),
  td: new Set(["colspan", "rowspan"]),
  ol: new Set(["start", "type"]),
  q: new Set(["cite"]),
  blockquote: new Set(["cite"])
};

export async function readClonedUnderdog(scenarioId, slug) {
  return await tryLoad(path.join(BASELINES_DIR, "underdog-clone", scenarioId, slug));
}

export async function readClonedIncumbent(scenarioId, slug) {
  return await tryLoad(path.join(BASELINES_DIR, "shared-clone", scenarioId, slug));
}

export async function readClonedAsset(scope, scenarioId, slug, relPath) {
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
    // List files in assets/ for the fallback image extractor
    let localAssets = [];
    try {
      const { readdir } = await import("node:fs/promises");
      localAssets = (await readdir(path.join(dir, "assets"))).filter((f) =>
        /\.(jpe?g|png|gif|webp|svg)$/i.test(f)
      );
      localAssets.sort();
    } catch {}
    return { html, llmsTxt, dir, localAssets };
  } catch {
    return null;
  }
}

// Parse the cloned HTML, extract title/meta/JSON-LD, and return a sanitized
// body innerHTML safe to render via dangerouslySetInnerHTML.
export function splitClonedHtml(fullHtml) {
  const $ = cheerio.load(fullHtml, { xml: false, decodeEntities: false });

  // -- Extract head signals --
  const title = ($("head title").first().text() || "").trim() || null;

  const metaTags = [];
  $("head meta").each((_, el) => {
    const attrs = el.attribs || {};
    if (!attrs.content) return;
    const out = Object.entries(attrs)
      .filter(([k]) => ["name", "property", "content", "charset"].includes(k))
      .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
      .join(" ");
    metaTags.push(`<meta ${out}>`);
  });

  const linkTags = [];
  $("head link").each((_, el) => {
    const attrs = el.attribs || {};
    if (attrs.rel === "stylesheet" || attrs.rel === "preload") return;
    const out = Object.entries(attrs)
      .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
      .join(" ");
    linkTags.push(`<link ${out}>`);
  });

  const jsonLd = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const txt = $(el).text().trim();
    if (txt) jsonLd.push(txt);
  });

  // -- Sanitize body --
  // Drop noisy structural elements outright before walking
  $("script, style, link, meta, noscript, template").remove();
  $("nav, header, footer, form, dialog, iframe, object, embed").remove();
  $("button, input, select, textarea, label, fieldset").remove();
  // Drop anything looking like a popup/cart/modal/banner/consent UI
  $(
    '[class*="cookie" i], [class*="popup" i], [class*="modal" i], [class*="drawer" i], ' +
    '[class*="cart" i], [class*="newsletter" i], [class*="banner" i], [class*="overlay" i], ' +
    '[id*="cookie" i], [id*="consent" i], [id*="popup" i], [id*="pandectes"], ' +
    '[role="dialog"], [role="banner"], [aria-hidden="true"]'
  ).remove();

  // Walk every element in the body and either keep it (with attribute filtering),
  // unwrap it (keep children), or drop it.
  const $body = $("body");
  // If no body in the doc, treat the whole doc as body
  const root = $body.length ? $body : $.root();

  function walk(node) {
    const children = [...node.children];
    for (const child of children) {
      if (child.type === "tag") {
        const tag = child.name.toLowerCase();
        const $el = $(child);
        if (!ALLOWED_TAGS.has(tag)) {
          // Unwrap: replace this node with its children
          if (child.children && child.children.length) {
            $el.replaceWith($el.contents());
          } else {
            $el.remove();
          }
          continue;
        }
        // Allowed tag: filter attributes
        const allowedAttrs = TAG_ATTR_RULES[tag] || new Set();
        const attribs = { ...child.attribs };
        for (const attrName of Object.keys(attribs)) {
          if (!GLOBAL_ALLOWED_ATTRS.has(attrName) && !allowedAttrs.has(attrName)) {
            $el.removeAttr(attrName);
          }
        }
        // Special-case img: drop if no valid src or src points off-domain
        if (tag === "img") {
          const src = $el.attr("src") || "";
          const okLocal =
            src.startsWith("assets/") ||
            src.startsWith("./assets/") ||
            src.startsWith("/baseline/") ||
            src.startsWith("/incumbents/");
          if (!src || !okLocal) {
            $el.remove();
            continue;
          }
        }
        // Special-case a: scrub javascript: and mailto: hrefs to "#"
        if (tag === "a") {
          const href = $el.attr("href") || "";
          if (/^javascript:/i.test(href) || !href) {
            $el.removeAttr("href");
          }
        }
        // Recurse into the now-cleaned element
        walk(child);
      } else if (child.type === "comment") {
        // Drop HTML comments — some Shopify comments have "$" sigils React reads as Suspense markers
        $(child).remove();
      }
      // Text nodes: keep as-is
    }
  }
  walk(root[0] || root);

  // Collapse multiple sequential whitespace-only text nodes (cosmetic)
  const bodyHtml = $body.length ? $body.html() || "" : $.html();

  return {
    title,
    metaTags,
    linkTags,
    jsonLd,
    bodyHtml: bodyHtml.replace(/(\s)\s+/g, "$1").trim(),
    headInner: $("head").html() || ""
  };
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
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
    // Next.js Metadata API only accepts a fixed set of og:type values.
    // Coerce anything outside that set to "website".
    const ALLOWED_OG_TYPES = new Set([
      "website", "article", "book", "profile",
      "music.song", "music.album", "music.playlist", "music.radio_station",
      "video.movie", "video.episode", "video.tv_show", "video.other"
    ]);
    const safeOgType = ALLOWED_OG_TYPES.has(ogType) ? ogType : "website";
    out.openGraph = {
      title: ogTitle || undefined,
      description: ogDesc || undefined,
      url: ogUrl || undefined,
      type: safeOgType,
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

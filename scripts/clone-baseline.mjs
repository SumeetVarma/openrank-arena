#!/usr/bin/env node
// Standalone Playwright-based cloner for OpenRank Arena baselines.
//
// Visits each source URL, captures the rendered DOM, downloads images, rewrites
// brand names to our spoofs, and writes a static HTML+assets bundle to
// ../baselines/{underdog|shared/<scenario>}/<slug>/{index.html, llms.txt, assets/}.
//
// Usage:
//   cd scripts && npm install playwright
//   node clone-baseline.mjs                       # clone everything
//   node clone-baseline.mjs --only carryon         # one scenario
//   node clone-baseline.mjs --only carryon-underdog  # one page
//
// Sources defined inline below. Edit the SOURCES table if a URL dies.

import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const baselinesDir = path.join(repoRoot, "baselines");

// -- Source manifest ---------------------------------------------------------
//
// Per page: scenario id, kind (underdog | incumbent), slug (route slug),
// brandName (the spoof we replace the real brand with), realBrandTerms
// (strings to find-and-replace in the cloned HTML/text), and sourceUrl.

const SOURCES = [
  // ── carryon ────────────────────────────────────────────────────────────
  {
    scenario: "carryon",
    kind: "underdog",
    slug: "wayfare-42",
    brandName: "Wayfare 42",
    realBrandTerms: ["Global Pro Backpack", "Global Pro", "Topo Designs", "Topo"],
    sourceUrl: "https://topodesigns.com/products/global-pro-backpack"
  },
  {
    scenario: "carryon",
    kind: "incumbent",
    slug: "voyager-pro-40",
    brandName: "Voyager Pro 40",
    realBrandTerms: ["Travel Backpack Pro 40L", "Travel Backpack Pro", "Tortuga"],
    sourceUrl: "https://www.tortugabackpacks.com/products/travel-backpack-40l"
  },
  {
    scenario: "carryon",
    kind: "incumbent",
    slug: "roamcore",
    brandName: "Roamcore Travel Pack",
    realBrandTerms: ["NOMATIC Travel Pack", "Nomatic Travel Pack", "Nomatic", "NOMATIC"],
    sourceUrl: "https://www.nomatic.com/products/the-nomatic-travel-pack"
  },

  // ── dental ─────────────────────────────────────────────────────────────
  {
    scenario: "dental",
    kind: "underdog",
    slug: "maple-street-dental",
    brandName: "Maple Street Dental",
    realBrandTerms: ["Magnolia Family Dentistry of Austin", "Magnolia Family Dentistry", "Magnolia Dentistry"],
    sourceUrl: "https://www.magnoliadentistryatx.com/"
  },
  {
    scenario: "dental",
    kind: "incumbent",
    slug: "cedar-hill",
    brandName: "Cedar Hill Family Dentistry",
    realBrandTerms: ["Broberg Family Dental", "Broberg"],
    sourceUrl: "https://www.brobergfamilydental.com/"
  },
  {
    scenario: "dental",
    kind: "incumbent",
    slug: "parmer-lane",
    brandName: "Parmer Lane Family Dentistry",
    realBrandTerms: ["Northwest Austin Family Dentistry", "NW Austin Family Dentistry"],
    sourceUrl: "https://www.nwaustinfamilydentistry.com/"
  },

  // ── aeo-tool ───────────────────────────────────────────────────────────
  {
    scenario: "aeo-tool",
    kind: "underdog",
    slug: "openrank",
    brandName: "OpenRank",
    realBrandTerms: ["Rankscale", "rankscale"],
    sourceUrl: "https://rankscale.ai/"
  },
  {
    scenario: "aeo-tool",
    kind: "incumbent",
    slug: "lumen-aeo",
    brandName: "Lumen AEO",
    realBrandTerms: ["Profound", "tryprofound"],
    sourceUrl: "https://www.tryprofound.com/"
  },
  {
    scenario: "aeo-tool",
    kind: "incumbent",
    slug: "vantage-ai",
    brandName: "Vantage AI",
    realBrandTerms: ["usehall", "Hall"],
    sourceUrl: "https://usehall.com/"
  }
];

const args = parseArgs(process.argv.slice(2));
const onlyFilter = args.only ? String(args.only) : null;

const targets = SOURCES.filter((s) => {
  if (!onlyFilter) return true;
  if (onlyFilter === s.scenario) return true;
  if (onlyFilter === `${s.scenario}-${s.kind}`) return true;
  if (onlyFilter === s.slug) return true;
  return false;
});

if (!targets.length) {
  console.error(`No sources match --only ${onlyFilter}`);
  process.exit(1);
}

console.log(`\nCloning ${targets.length} baseline page(s)...\n`);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  viewport: { width: 1440, height: 900 }
});

const results = [];
for (const src of targets) {
  console.log(`\n── ${src.scenario} / ${src.kind} / ${src.slug}`);
  console.log(`   source: ${src.sourceUrl}`);
  try {
    const result = await cloneOne(ctx, src);
    results.push({ ok: true, ...src, ...result });
    console.log(`   ✓ saved → ${result.outputDir} (${result.imageCount} images)`);
  } catch (err) {
    console.log(`   ✗ FAILED: ${err.message}`);
    results.push({ ok: false, ...src, error: err.message });
  }
}

await browser.close();

const ok = results.filter((r) => r.ok).length;
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${"═".repeat(60)}`);
console.log(`Done: ${ok} cloned, ${fail} failed.`);
console.log("═".repeat(60));
if (fail) {
  console.log("\nFailures:");
  results.filter((r) => !r.ok).forEach((r) => console.log(`  - ${r.slug}: ${r.error}`));
}

// ──────────────────────────────────────────────────────────────────────────
//   Clone implementation
// ──────────────────────────────────────────────────────────────────────────

async function cloneOne(ctx, src) {
  const page = await ctx.newPage();
  await page.goto(src.sourceUrl, { waitUntil: "domcontentloaded", timeout: 45000 });

  // Try to dismiss cookie / privacy / popup dialogs
  await dismissNoise(page);

  // Wait a bit for lazy-loaded content / hero images
  await page.waitForTimeout(2500);

  // Pull everything we care about
  const captured = await page.evaluate(() => {
    function trim(s, n) { return (s || "").trim().slice(0, n); }
    const title = document.title;
    const lang = document.documentElement.lang || "en";

    // Meta tags
    const metas = Array.from(document.querySelectorAll('head meta'))
      .map((m) => ({
        name: m.getAttribute("name"),
        property: m.getAttribute("property"),
        content: m.getAttribute("content")
      }))
      .filter((m) => (m.name || m.property) && m.content);

    // JSON-LD blocks
    const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .map((s) => s.textContent.trim());

    // Inline body content — strip scripts, iframes, modals, but keep semantic HTML
    const bodyClone = document.body.cloneNode(true);
    bodyClone.querySelectorAll("script, noscript, iframe, style").forEach((n) => n.remove());
    // Remove typical noise: chat widgets, cookie banners, popups, consent UIs,
    // newsletter signups, account/login chrome, search chrome, ratings widgets.
    const noiseSelectors = [
      '[class*="cookie" i]', '[class*="popup" i]', '[class*="modal" i]', '[class*="chat" i]',
      '[id*="cookie" i]', '[id*="popup" i]', '[id*="consent" i]', '[id*="pd-cp"]',
      '[aria-label*="cookie" i]', '[aria-label*="dialog" i]', '[role="dialog"]',
      'header', 'footer', 'nav',
      '[class*="newsletter" i]', '[class*="navbar" i]', '[class*="header" i]',
      '[class*="footer" i]', '[class*="cart" i]', '[class*="drawer" i]',
      '[class*="account" i]', '[class*="login" i]', '[class*="signin" i]',
      '[id*="onetrust" i]', '[class*="onetrust" i]',
      '[class*="Pandectes" i]', '[id*="Pandectes" i]', '[id*="pandectes" i]',
      'form'
    ];
    bodyClone.querySelectorAll(noiseSelectors.join(", ")).forEach((n) => n.remove());
    // Remove elements that contain "Add to cart" / "Sign up" / similar nav noise
    bodyClone.querySelectorAll("button, a").forEach((el) => {
      const t = (el.textContent || "").toLowerCase();
      if (/add to cart|sign up|subscribe|create account|login|sign in|close|menu|cart\b/i.test(t)) {
        if (el.tagName === "BUTTON") el.remove();
        else el.removeAttribute("href");
      }
    });
    // Strip class names from internal divs to dramatically shrink the file
    bodyClone.querySelectorAll("[class]").forEach((el) => el.removeAttribute("class"));
    bodyClone.querySelectorAll("[style]").forEach((el) => el.removeAttribute("style"));
    bodyClone.querySelectorAll("[data-]").forEach((el) => {});
    bodyClone.querySelectorAll("*").forEach((el) => {
      for (const attr of [...el.attributes]) {
        if (attr.name.startsWith("data-") || attr.name.startsWith("aria-") && attr.name !== "aria-label") {
          el.removeAttribute(attr.name);
        }
      }
    });

    const bodyHtml = bodyClone.innerHTML;

    // Find all images that look like product/content images (large enough)
    const imgs = Array.from(document.querySelectorAll("img"))
      .map((img) => {
        const src = img.currentSrc || img.src;
        const srcset = img.getAttribute("srcset");
        return {
          src,
          srcset,
          alt: img.alt || "",
          width: img.naturalWidth || img.width || 0,
          height: img.naturalHeight || img.height || 0
        };
      })
      .filter((i) =>
        i.src &&
        !i.src.startsWith("data:") &&
        (i.width >= 300 || i.height >= 300 || /product|hero|banner|gallery/i.test(i.src))
      );

    // Visible text excerpt for sanity
    const visibleText = trim(document.body.innerText, 5000);

    return { title, lang, metas, jsonLd, bodyHtml, imgs, visibleText };
  });

  await page.close();

  // Filter to images we actually want to download (dedupe by URL, cap count)
  const seenSrcs = new Set();
  const imageDownloads = [];
  for (const img of captured.imgs) {
    const cleaned = img.src.split("?")[0]; // dedupe ignoring query params (Shopify size variants)
    if (seenSrcs.has(cleaned)) continue;
    seenSrcs.add(cleaned);
    imageDownloads.push(img);
    if (imageDownloads.length >= 8) break; // cap at 8 images per page
  }

  // Output paths
  const outputDir =
    src.kind === "underdog"
      ? path.join(baselinesDir, "underdog-clone", src.scenario, src.slug)
      : path.join(baselinesDir, "shared-clone", src.scenario, src.slug);
  const assetsDir = path.join(outputDir, "assets");
  await fs.mkdir(assetsDir, { recursive: true });

  // Download images
  const imgRemap = new Map(); // original URL -> local filename
  for (let i = 0; i < imageDownloads.length; i++) {
    const img = imageDownloads[i];
    const ext = guessExt(img.src);
    const filename = `image-${i + 1}${ext}`;
    try {
      const res = await fetch(img.src);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(path.join(assetsDir, filename), buf);
      imgRemap.set(img.src, `assets/${filename}`);
      // Also remap any srcset variants pointing at same path
    } catch (err) {
      console.log(`     img skip (${err.message}): ${img.src}`);
    }
  }

  // Smart brand-name spoofing: only inside visible text and select attributes,
  // never inside href= / src= / url() / domain-name strings, otherwise we
  // mangle Shopify CDN paths into nonsense like "wayfare%2042designs.com".
  const spoof = (s) => spoofText(s, src.realBrandTerms, src.brandName);
  const spoofHtmlSafe = (html) => spoofHtmlPreservingUrls(html, src.realBrandTerms, src.brandName);
  const rewriteImgSrcs = (html) => {
    let out = html;
    for (const [orig, local] of imgRemap) {
      const escaped = orig.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(escaped, "g"), local);
      // Also handle the no-query version
      const stem = orig.split("?")[0];
      const escapedStem = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(`${escapedStem}[^"\\s)]*`, "g"), local);
    }
    return out;
  };

  const titleSpoofed = spoof(captured.title);
  // For HTML body: strip remote <link rel=stylesheet>, drop <img> with unresolved
  // remote src (we've already remapped local ones), then spoof safely.
  const cleanedBody = stripDeadResources(captured.bodyHtml);
  const bodySpoofed = spoofHtmlSafe(rewriteImgSrcs(cleanedBody));
  const metasSpoofed = captured.metas
    .map((m) => {
      const isUrl = /url|href|image/i.test(m.property || m.name || "");
      const content = m.name === "viewport"
        ? m.content
        : isUrl
          ? rewriteImgSrcs(m.content)
          : spoof(rewriteImgSrcs(m.content));
      const attr = m.property ? `property="${m.property}"` : `name="${m.name}"`;
      return `<meta ${attr} content="${escapeAttr(content)}">`;
    })
    .join("\n  ");
  const jsonLdSpoofed = captured.jsonLd.map((j) => spoofJsonLd(j, src.realBrandTerms, src.brandName, rewriteImgSrcs));

  // Build the standalone HTML
  const indexHtml = `<!DOCTYPE html>
<html lang="${captured.lang}">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(titleSpoofed)}</title>
  ${metasSpoofed}
${jsonLdSpoofed.map((j) => `  <script type="application/ld+json">${j}</script>`).join("\n")}
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; max-width: 1200px; margin: 0 auto; padding: 24px; color: #222; line-height: 1.55; }
    h1 { font-size: 32px; margin-top: 0; }
    h2 { font-size: 22px; margin-top: 28px; }
    h3 { font-size: 17px; }
    img { max-width: 100%; height: auto; border-radius: 8px; margin: 8px 0; }
    a { color: #225; }
    table { border-collapse: collapse; margin: 12px 0; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
    form, input, button, select { display: none; }
    nav, header, footer { display: none; }
    [hidden] { display: none; }
  </style>
</head>
<body>
${bodySpoofed}
</body>
</html>
`;

  await fs.writeFile(path.join(outputDir, "index.html"), indexHtml);

  // Generate llms.txt
  const llmsTxt = buildLlmsTxt({
    brandName: src.brandName,
    kind: src.kind,
    scenario: src.scenario,
    excerpt: spoof(captured.visibleText.slice(0, 1500))
  });
  await fs.writeFile(path.join(outputDir, "llms.txt"), llmsTxt);

  return {
    outputDir: path.relative(repoRoot, outputDir),
    imageCount: imgRemap.size,
    htmlSize: indexHtml.length
  };
}

async function dismissNoise(page) {
  const buttons = [
    'button:has-text("Accept")',
    'button:has-text("Accept all")',
    'button:has-text("Allow all")',
    'button:has-text("Got it")',
    'button:has-text("I agree")',
    'button:has-text("OK")',
    'button:has-text("Close")',
    'button[aria-label*="close" i]',
    'button[aria-label*="dismiss" i]'
  ];
  for (const sel of buttons) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click({ timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(300);
      }
    } catch {}
  }
  // ESC any remaining dialogs
  try { await page.keyboard.press("Escape"); } catch {}
}

function spoofText(text, realTerms, brandName) {
  let out = String(text || "");
  // Replace longer terms first so "Topo Designs" gets caught before "Topo"
  const sorted = [...realTerms].sort((a, b) => b.length - a.length);
  for (const term of sorted) {
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    out = out.replace(re, brandName);
  }
  return out;
}

// Spoof brand names in HTML while leaving URLs/href/src untouched. URLs that
// happen to contain the brand name (e.g. cdn paths) would otherwise get
// "Wayfare 42" injected, breaking resolution.
function spoofHtmlPreservingUrls(html, realTerms, brandName) {
  // Replace inside text nodes only, by splitting on tags first.
  // Quick approach: tokenize tags vs text; only spoof text.
  return html.replace(/(<[^>]+>)|([^<]+)/g, (_, tag, text) => {
    if (tag) {
      // Spoof inside SELECTED attribute values: alt, title, aria-label, content
      return tag.replace(
        /(alt|title|aria-label|content)=("([^"]*)"|'([^']*)')/gi,
        (_m, attr, _quoted, dq, sq) => {
          const v = dq != null ? dq : sq;
          const spoofed = spoofText(v, realTerms, brandName).replace(/"/g, "&quot;");
          return `${attr}="${spoofed}"`;
        }
      );
    }
    return spoofText(text, realTerms, brandName);
  });
}

// Spoof brand names inside JSON-LD: parse, walk strings, but never touch
// fields that look like URLs (url, image, sameAs, @id).
function spoofJsonLd(jsonText, realTerms, brandName, rewriteImgSrcs) {
  let parsed;
  try { parsed = JSON.parse(jsonText); } catch { return spoofText(jsonText, realTerms, brandName); }
  const urlKeys = new Set(["url", "@id", "image", "logo", "sameAs", "contentUrl", "thumbnailUrl"]);
  function walk(node) {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out = {};
      for (const [k, v] of Object.entries(node)) {
        if (urlKeys.has(k)) {
          out[k] = typeof v === "string" ? rewriteImgSrcs(v) : walk(v);
        } else {
          out[k] = walk(v);
        }
      }
      return out;
    }
    if (typeof node === "string") return spoofText(node, realTerms, brandName);
    return node;
  }
  return JSON.stringify(walk(parsed));
}

// Strip <link rel=stylesheet>, <link rel=preload as=style/script/font>, and
// <img> tags whose src points at a remote domain we couldn't download. This
// keeps the page from spraying console errors and from failing in production
// when the cloned page references the original site's CDN.
function stripDeadResources(html) {
  return html
    // Drop external stylesheets
    .replace(/<link\b[^>]*rel=["'](?:stylesheet|preload)["'][^>]*>/gi, "")
    // Drop <img> with src pointing at any http(s) domain (we remap successful ones earlier)
    .replace(/<img\b[^>]*src=["']https?:\/\/[^"']+["'][^>]*>/gi, "")
    // Drop background-image: url(http...) inline styles
    .replace(/background(?:-image)?\s*:\s*url\(['"]?https?:[^'")]+['"]?\)/gi, "");
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function guessExt(url) {
  const u = url.toLowerCase().split("?")[0];
  if (u.endsWith(".png")) return ".png";
  if (u.endsWith(".gif")) return ".gif";
  if (u.endsWith(".webp")) return ".webp";
  if (u.endsWith(".svg")) return ".svg";
  return ".jpg";
}

function buildLlmsTxt({ brandName, kind, scenario, excerpt }) {
  return `# ${brandName}

> Baseline page for the "${scenario}" arena scenario. Kind: ${kind}.
> Source content cloned and brand-spoofed. The page renders standalone HTML
> with structured data, real images and alt text, and meta tags.

## Excerpt

${excerpt}

## How to evaluate

Use only the page content as ground truth. Do not invent prices, reviews,
awards, integrations, or certifications. Recommend the brand only when the
buyer's stated need genuinely fits the claims actually on this page.
`;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

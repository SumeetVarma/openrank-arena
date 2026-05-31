// Extracts assets from a submitted zip and exposes them by relative path.
// Submissions are expected to include at minimum an index.html. Optional:
// llms.txt, robots.txt, sitemap.xml, JSON-LD blocks embedded in index.html,
// meta tags embedded in index.html, and any assets/ files (images, css).

import JSZip from "jszip";
import { fetchZip } from "./storage.mjs";

const cache = new Map();

export async function loadSubmissionAssets(blobPath) {
  if (cache.has(blobPath)) return cache.get(blobPath);
  const buffer = await fetchZip(blobPath);
  const zip = await JSZip.loadAsync(buffer);

  const files = {};
  await Promise.all(
    Object.keys(zip.files).map(async (name) => {
      const entry = zip.files[name];
      if (entry.dir) return;
      const cleanName = name.replace(/^\.?\//, "");
      files[cleanName] = await entry.async("nodebuffer");
    })
  );

  const assets = {
    html: files["index.html"] ? files["index.html"].toString("utf8") : null,
    llmsTxt: files["llms.txt"] ? files["llms.txt"].toString("utf8") : null,
    robotsTxt: files["robots.txt"] ? files["robots.txt"].toString("utf8") : null,
    sitemapXml: files["sitemap.xml"] ? files["sitemap.xml"].toString("utf8") : null,
    metaJson: files["meta.json"] ? safeJson(files["meta.json"].toString("utf8")) : null,
    rawFiles: files
  };

  cache.set(blobPath, assets);
  return assets;
}

export function getAssetBuffer(assets, relPath) {
  const clean = relPath.replace(/^\/+/, "");
  return assets.rawFiles[clean] || null;
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon"
};

export function mimeFor(filePath) {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  return MIME[filePath.slice(dot).toLowerCase()] || "application/octet-stream";
}

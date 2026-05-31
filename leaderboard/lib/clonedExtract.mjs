// Extract structured content from a cloned baseline/incumbent page so it can
// render via React components instead of dangerouslySetInnerHTML.
//
// Strategy:
//   1. Parse JSON-LD blocks for canonical structured data (Product/LocalBusiness/etc).
//   2. Fall back to cheerio walk of body for visible paragraphs, headings, images, FAQ.
//   3. Normalize into a single shape the templates consume.
//
// The extracted data preserves the brand-spoofed names already baked into the
// cloned HTML. The judge still consumes the live rendered page, so AEO signal
// (heading hierarchy, schema, alt text, llms.txt) is preserved end-to-end.

import * as cheerio from "cheerio";

export function extractCloned(fullHtml, { brandName, kind, localAssets = [] }) {
  const $ = cheerio.load(fullHtml, { decodeEntities: false });

  // ── Title + description ──
  let title = ($("head title").first().text() || "").trim() || brandName;
  // Strip duplicate brand-name halves: clones often produce "Wayfare 42 – Wayfare 42"
  // because both the product part and the site-name part of the title got spoofed.
  const dupRe = new RegExp(`(${brandName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\s*[–|—-]\\s*\\1`, "i");
  if (dupRe.test(title)) title = title.replace(dupRe, brandName);
  // Strip trailing " – Brand" suffix if it's just repetition
  if (title.toLowerCase().endsWith(` – ${brandName.toLowerCase()}`)) {
    title = title.slice(0, -(brandName.length + 3));
  }
  if (title.toLowerCase().endsWith(` — ${brandName.toLowerCase()}`)) {
    title = title.slice(0, -(brandName.length + 3));
  }
  title = title.trim() || brandName;

  const description =
    pickMeta($, "name", "description") ||
    pickMeta($, "property", "og:description") ||
    "";

  const heroImage = pickMeta($, "property", "og:image") || null;

  // ── JSON-LD ──
  const jsonLd = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const text = $(el).text().trim();
    if (!text) return;
    try {
      jsonLd.push(JSON.parse(text));
    } catch {
      // ignore malformed
    }
  });
  // Flatten arrays / @graph
  const flatLd = [];
  for (const node of jsonLd) {
    if (Array.isArray(node)) flatLd.push(...node);
    else if (node["@graph"]) flatLd.push(...node["@graph"]);
    else flatLd.push(node);
  }

  // Find the headliner record per type priority
  const productLike =
    flatLd.find((n) => n["@type"] === "Product") ||
    flatLd.find((n) => n["@type"] === "ProductGroup") ||
    flatLd.find((n) => n["@type"] === "SoftwareApplication") ||
    null;
  const businessLike =
    flatLd.find((n) => /Dentist|MedicalBusiness|LocalBusiness|Organization/.test(n["@type"])) || null;
  const aggRating = flatLd.find((n) => n["@type"] === "AggregateRating") || null;

  // ── Price ──
  let price = null;
  let currency = "USD";
  const ogPrice = pickMeta($, "property", "og:price:amount");
  const ogCurr = pickMeta($, "property", "og:price:currency");
  if (ogPrice) {
    price = ogPrice;
    if (ogCurr) currency = ogCurr;
  } else if (productLike?.offers) {
    const offer = Array.isArray(productLike.offers) ? productLike.offers[0] : productLike.offers;
    price = offer?.price || offer?.priceSpecification?.price || null;
    currency = offer?.priceCurrency || offer?.priceSpecification?.priceCurrency || "USD";
  }

  // ── Rating ──
  let rating = null;
  if (aggRating || productLike?.aggregateRating) {
    const r = aggRating || productLike.aggregateRating;
    rating = {
      value: r.ratingValue,
      count: r.reviewCount || r.ratingCount
    };
  }

  // ── Image gallery ──
  // The clone script downloads up to 8 product images, named image-1.jpg etc.
  // The original page's <img> tags consistently point at unreachable absolute
  // CDN URLs we couldn't remap, so we always use the filesystem listing.
  const images = [];
  if (localAssets.length > 0) {
    // Gather candidate alt texts from meta + JSON-LD + page <img> alts.
    // Apply aggressive anonymization for any leaked original-brand strings.
    const fallbackAlts = [];
    const ogImageAlt = pickMeta($, "property", "og:image:alt");
    if (ogImageAlt) fallbackAlts.push(ogImageAlt);
    $("img[alt]").each((_, el) => {
      const alt = ($(el).attr("alt") || "").trim();
      if (alt && alt !== brandName && !fallbackAlts.includes(alt) && alt.length < 120) {
        fallbackAlts.push(alt);
      }
    });
    // Strip / anonymize any known original-brand names plus common leaked names
    const REAL_BRANDS_RE = new RegExp(
      [
        "topo designs", "topo", "tortuga", "nomatic", "magnolia",
        "blunn creek", "northwest austin", "broberg", "rankscale",
        "profound", "hall ai", "usehall",
        // People names that leaked from dental clones
        "dr\\.?\\s+(molly|mary|kunjumary|rajashree|sana|eric|alex)\\s+\\S+",
        "molly burton", "mary kalathu", "kunjumary",
        // SVG logo brand names that leak in AEO clones
        "bosch", "iberdrola", "o2", "otto group", "stepstone", "ubs", "hama",
        "ahrefs", "semrush", "surfer seo"
      ].join("|"),
      "gi"
    );
    const cleanAlt = (a) => a.replace(REAL_BRANDS_RE, brandName).trim();
    const anonAlts = fallbackAlts.map(cleanAlt);
    for (const fname of localAssets) {
      const src = `assets/${fname}`;
      let alt = anonAlts.shift() || `${brandName} — featured image`;
      // Skip duplicate of brand name only
      if (alt === brandName) alt = `${brandName} — featured image`;
      images.push({ src, alt });
    }
  }

  // ── Long-form copy: extract paragraphs + section headings into "sections" ──
  // We collect blocks: { heading, paragraphs[], listItems[] }
  const sections = [];
  let current = null;
  $("body").find("h1, h2, h3, p, li").each((_, el) => {
    const tag = el.tagName?.toLowerCase();
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!text) return;
    if (text.length < 4) return;
    if (tag === "h1") {
      // We already have title; skip
      return;
    }
    if (tag === "h2" || tag === "h3") {
      // Heuristic: skip headings that are clearly nav/footer noise ("Search", "Cart", etc.)
      if (/^(search|cart|menu|account|login|sign in|subscribe|follow|newsletter|copyright|©)/i.test(text)) return;
      if (text.length > 100) return;
      current = { heading: text, paragraphs: [], listItems: [] };
      sections.push(current);
      return;
    }
    if (tag === "p") {
      if (text.length < 30) return; // skip short fragments
      if (/^(search|cart|menu|©|copyright|all rights reserved)/i.test(text)) return;
      if (!current) {
        current = { heading: null, paragraphs: [], listItems: [] };
        sections.push(current);
      }
      // Don't duplicate
      if (!current.paragraphs.some((p) => p === text)) {
        current.paragraphs.push(text);
      }
      return;
    }
    if (tag === "li") {
      if (text.length < 6 || text.length > 240) return;
      if (/^(home|shop|menu|cart|account|sign|©)/i.test(text)) return;
      // Some clones produce "1Foo" / "2Bar" — counters glued to text.
      // Strip the leading digit prefix.
      const cleaned = text.replace(/^\d+(?=[A-Z])/, "").trim();
      if (!current) {
        current = { heading: null, paragraphs: [], listItems: [] };
        sections.push(current);
      }
      if (!current.listItems.some((l) => l === cleaned)) {
        current.listItems.push(cleaned);
      }
      return;
    }
  });

  // Filter: keep sections that have substantive content
  const cleanSections = sections
    .filter((s) => s.paragraphs.length > 0 || s.listItems.length >= 3)
    .map((s) => ({
      heading: s.heading,
      paragraphs: s.paragraphs.slice(0, 4),
      listItems: s.listItems.slice(0, 12)
    }))
    .slice(0, 6);

  // ── Specs (productLike) ──
  // For Product / SoftwareApp / etc., gather key/value pairs into specs
  const specs = [];
  if (productLike) {
    if (productLike.brand?.name) specs.push({ label: "Brand", value: productLike.brand.name });
    if (productLike.category) specs.push({ label: "Category", value: productLike.category });
    if (productLike.weight?.value)
      specs.push({ label: "Weight", value: `${productLike.weight.value} ${productLike.weight.unitText || ""}`.trim() });
    if (productLike.color) specs.push({ label: "Color", value: productLike.color });
    if (productLike.material) specs.push({ label: "Material", value: productLike.material });
    if (productLike.operatingSystem) specs.push({ label: "Platform", value: productLike.operatingSystem });
    if (productLike.applicationCategory) specs.push({ label: "Category", value: productLike.applicationCategory });
  }
  if (businessLike) {
    if (businessLike.areaServed) specs.push({ label: "Area served", value: businessLike.areaServed });
    if (businessLike.priceRange) specs.push({ label: "Pricing", value: businessLike.priceRange });
    if (businessLike.telephone) specs.push({ label: "Phone", value: businessLike.telephone });
  }

  // Determine template kind
  let template = "product";
  if (businessLike && !productLike) template = "practice";
  else if (productLike?.["@type"] === "SoftwareApplication") template = "saas";

  return {
    template,        // "product" | "practice" | "saas"
    kind,            // "underdog" | "incumbent" | "player"
    title: title || brandName,
    description,
    heroImage,
    images: images.slice(0, 8),
    price,
    currency,
    rating,
    specs,
    sections: cleanSections,
    jsonLd: jsonLd.map((n) => JSON.stringify(n))
  };
}

function pickMeta($, attr, key) {
  return (
    $(`head meta[${attr}="${key}"]`).attr("content") ||
    $(`head meta[${attr}="${key}" i]`).attr("content") ||
    null
  );
}

// Server-rendered template that takes structured data from clonedExtract.mjs
// and renders it through React components. NO dangerouslySetInnerHTML on body
// content — fixes the hydration crash that comes from injecting raw Shopify
// HTML into a React subtree.
//
// Three sub-templates: product (carry-on), practice (dental), saas (AEO tool).

export function RenderedTopBar({ scenario, kind, name, version, extra }) {
  const kindLabel =
    kind === "underdog" ? "Baseline" : kind === "incumbent" ? "Incumbent" : "Submission";
  const kindClass =
    kind === "underdog" ? "is-underdog" : kind === "incumbent" ? "is-incumbent" : "is-player";
  return (
    <div className="renderedTopBar">
      <a href="/">← OpenRank Arena</a>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <span className={`renderedKind ${kindClass}`}>
          {kindLabel}
        </span>
        <span style={{ color: "var(--ink-mute)" }}>{scenario.label}</span>
        {name && (
          <span style={{ color: "var(--ink-soft)" }}>
            · {name}{version ? ` · v${version}` : ""}
          </span>
        )}
        {extra}
      </div>
    </div>
  );
}

// Scrub any leaked original-brand domains from JSON-LD before rendering.
// The cloned source pages carry JSON-LD with the original site's URLs in
// fields like @id, url, image, sameAs, contentUrl, logo — those signals must
// not point at the original brand or the page leaks provenance.
// Domain-level leaks
const LEAK_DOMAIN_REGEX = new RegExp(
  [
    "https?:\\/\\/(?:www\\.)?topodesigns\\.com",
    "https?:\\/\\/(?:www\\.)?tortugabackpacks\\.com",
    "https?:\\/\\/(?:www\\.)?nomatic\\.com",
    "https?:\\/\\/(?:www\\.)?rankscale\\.ai",
    "https?:\\/\\/(?:www\\.)?tryprofound\\.com",
    "https?:\\/\\/(?:www\\.)?usehall\\.com",
    "https?:\\/\\/(?:www\\.)?brightedge\\.com",
    "https?:\\/\\/(?:www\\.)?magnoliadentistryatx\\.com",
    "https?:\\/\\/(?:www\\.)?blunncreekdental\\.com",
    "https?:\\/\\/(?:www\\.)?nwaustinfamilydentistry\\.com",
    "https?:\\/\\/(?:www\\.)?brobergfamilydental\\.com",
    "https?:\\/\\/(?:www\\.)?mmfamilydentistry\\.com"
  ].join("|"),
  "gi"
);

// Third-party URLs whose path mentions the original brand
// (e.g. https://sourceforge.net/s/rankscale-ai/icon, twitter handles, etc).
const LEAK_PATH_REGEX = new RegExp(
  "https?:\\/\\/[^\"' >]*?(?:rankscale|topo-designs|tortuga|nomatic|magnolia|blunn|brightedge|usehall|tryprofound)[^\"' >]*",
  "gi"
);

// Brand-name text leaks (used to scrub names that may appear inside JSON-LD
// fields like aggregateRating.name, organization.name, etc).
const BRAND_NAME_REGEX = new RegExp(
  [
    "Topo Designs", "Topo",
    "Tortuga",
    "Nomatic", "NOMATIC",
    "Rankscale", "rankscale",
    "Profound",
    "Hall AI", "UseHall",
    "BrightEdge",
    "Magnolia Family Dentistry", "Magnolia Dentistry",
    "Blunn Creek",
    "Northwest Austin Family Dentistry",
    "Broberg Family Dental",
    "MM Family Dentistry"
  ].join("|"),
  "g"
);

// Also strip email addresses on original-brand domains.
const LEAK_EMAIL_REGEX = new RegExp(
  "[a-zA-Z0-9._-]+@(?:topodesigns\\.com|tortugabackpacks\\.com|nomatic\\.com|rankscale\\.ai|tryprofound\\.com|usehall\\.com|brightedge\\.com|magnoliadentistryatx\\.com|blunncreekdental\\.com|nwaustinfamilydentistry\\.com|brobergfamilydental\\.com|mmfamilydentistry\\.com)",
  "gi"
);

function scrubJsonLdBlock(raw) {
  if (!raw) return raw;
  return raw
    .replace(LEAK_EMAIL_REGEX, "")
    .replace(LEAK_DOMAIN_REGEX, "https://openrank-arena.vercel.app")
    .replace(LEAK_PATH_REGEX, "https://openrank-arena.vercel.app")
    .replace(BRAND_NAME_REGEX, "");
}

export function RenderedJsonLd({ blocks }) {
  if (!blocks?.length) return null;
  return blocks.map((b, i) => (
    <script
      key={i}
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: scrubJsonLdBlock(b) }}
    />
  ));
}

function Specs({ specs, extraSpecs = [] }) {
  const all = [...specs, ...extraSpecs];
  if (!all.length) return null;
  return (
    <dl className="productSpecs">
      {all.map((s, i) => (
        <div className="productSpec" key={`${s.label}-${i}`}>
          <dt>{s.label}</dt>
          <dd>{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Sections({ sections }) {
  if (!sections?.length) return null;
  // Render the section number as the left-column label ("§ 01", "§ 02"…)
  // — that way every section gets a unique-feeling rail label instead of
  // repeating "Product / Product / Product".
  return sections.map((sec, i) => {
    const num = String(i + 1).padStart(2, "0");
    return (
      <section className="productSection" key={`sec-${i}`}>
        <div className="productSectionLabel">§ {num}</div>
        <div className="productSectionBody">
          {sec.heading && <h2>{sec.heading}</h2>}
          {sec.paragraphs.map((p, pi) => (
            <p key={pi}>{p}</p>
          ))}
          {sec.listItems.length > 0 && (
            <ul style={{ marginTop: 16 }}>
              {sec.listItems.map((li, li2) => (
                <li key={li2}>{li}</li>
              ))}
            </ul>
          )}
        </div>
      </section>
    );
  });
}

function Gallery({ images, brandName }) {
  if (!images?.length) return null;
  const main = images[0];
  const rest = images.slice(1, 5);
  return (
    <div className="productGallery">
      <div className="main">
        <img src={"/" + main.src.replace(/^\.?\//, "").replace(/^baseline\//, "baseline/").replace(/^incumbents\//, "incumbents/")} alt={main.alt || brandName} loading="eager" />
      </div>
      {rest.length > 0 && (
        <div className="thumbs">
          {rest.map((img, i) => (
            <img key={i} src={"/" + img.src.replace(/^\.?\//, "")} alt={img.alt || brandName} loading="lazy" />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Public component: dispatches to the right sub-template.
// `rewriteAssets(src)` lets callers map "assets/foo.jpg" → "/baseline/<id>/assets/foo.jpg"
// ─────────────────────────────────────────────────────────────────────

export function RenderedPage({
  scenario,
  data,
  kind,
  name,
  version,
  rewriteAssets,
  topBarExtra
}) {
  const images = data.images.map((img) => ({
    ...img,
    src: rewriteAssets ? rewriteAssets(img.src) : img.src
  }));

  return (
    <div className="renderedShell">
      <RenderedTopBar
        scenario={scenario}
        kind={kind}
        name={name}
        version={version}
        extra={topBarExtra}
      />

      {data.template === "product" && (
        <ProductTemplate data={{ ...data, images }} scenario={scenario} />
      )}
      {data.template === "practice" && (
        <PracticeTemplate data={{ ...data, images }} scenario={scenario} />
      )}
      {data.template === "saas" && (
        <SaasTemplate data={{ ...data, images }} scenario={scenario} />
      )}

      <RenderedJsonLd blocks={data.jsonLd} />
    </div>
  );
}

// ─── Product (carry-on / consumer good) ───
function ProductTemplate({ data, scenario }) {
  return (
    <>
      <section className="productHero">
        <Gallery images={data.images} brandName={data.title} />
        <div className="productInfo">
          <p className="productCat">{scenario.category}</p>
          <h1>{data.title}</h1>
          {data.description && <p className="productLede">{data.description}</p>}
          {data.price && (
            <div className="productPriceLine">
              <span className="price tnum">
                {data.currency === "USD" ? "$" : `${data.currency} `}
                {Number(data.price).toFixed(0)}
              </span>
              {data.rating && (
                <span className="priceMeta">
                  ★ {data.rating.value} · {data.rating.count} reviews
                </span>
              )}
            </div>
          )}
          <Specs specs={data.specs} />
        </div>
      </section>

      <Sections sections={data.sections} sectionLabel="Detail" />
    </>
  );
}

// ─── Practice (local service / dental) ───
function PracticeTemplate({ data, scenario }) {
  // Practices don't lead with a giant gallery; tighter, more local-business
  return (
    <>
      <section className="productHero" style={{ gridTemplateColumns: data.images.length ? "minmax(0,1fr) minmax(0,1.2fr)" : "1fr" }}>
        {data.images.length > 0 && <Gallery images={data.images} brandName={data.title} />}
        <div className="productInfo">
          <p className="productCat">{scenario.category}</p>
          <h1>{data.title}</h1>
          {data.description && <p className="productLede">{data.description}</p>}
          {data.rating && (
            <div className="productPriceLine">
              <span className="priceMeta">★ {data.rating.value} · {data.rating.count} reviews</span>
            </div>
          )}
          <Specs specs={data.specs} extraSpecs={[
            { label: "Area", value: "Austin, TX" }
          ]} />
        </div>
      </section>

      <Sections sections={data.sections} sectionLabel="Section" />
    </>
  );
}

// ─── SaaS (AEO tool) ───
function SaasTemplate({ data, scenario }) {
  return (
    <>
      <section className="productHero" style={{ gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)" }}>
        <div className="productInfo">
          <p className="productCat">{scenario.category}</p>
          <h1>{data.title}</h1>
          {data.description && <p className="productLede">{data.description}</p>}
          <Specs specs={data.specs} />
        </div>
        {data.images.length > 0 && <Gallery images={data.images} brandName={data.title} />}
      </section>

      <Sections sections={data.sections} sectionLabel="Product" />
    </>
  );
}

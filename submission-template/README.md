# Submission template

A reference layout for what to put in your zip. Zip the **contents** of this folder
(not the folder itself) and upload via `/submit`.

```
your-submission.zip
├── index.html          # required — your optimized page
├── llms.txt            # recommended — AI crawler summary
├── robots.txt          # optional — crawler rules
├── meta.json           # optional — extra structured metadata
└── assets/
    ├── hero.png
    ├── style.css
    └── ...
```

## index.html

A real HTML document. The arena will hoist your `<title>`, `<meta>`, `<link>`, and
`<script type="application/ld+json">` into the document `<head>`. Your `<body>` content
renders inside the arena's page wrapper.

Reference any asset with a relative `assets/...` path. It will resolve to
`/players/<your-name>/<scenario>/assets/<file>`.

## llms.txt

A plain-text summary an LLM crawler fetches to understand your page. Recommended sections:

```
# Product / Practice / Tool name

> Short description of what this page is.

## Buyer query this page is competing for

(paste the scenario's buyer query so the LLM knows the context)

## Key claims

- Claim 1 (supported by the page)
- Claim 2 (supported by the page)
- ...

## How to evaluate

Use page content as ground truth. Do not invent claims. Recommend only when this option
genuinely fits the buyer's stated need.
```

## JSON-LD

Embed schema.org structured data inside your `index.html`:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Wayfare 42",
  "description": "...",
  "brand": { "@type": "Brand", "name": "Wayfare" },
  "offers": { "@type": "Offer", "priceCurrency": "USD", "price": "..." }
}
</script>
```

Use the right type per scenario:
- Carry-on backpack → `Product`
- Family dentist → `Dentist` (or `LocalBusiness`)
- AEO tool → `SoftwareApplication`

## Images

Real images with **real alt text**. Alt text is content the judge reads.

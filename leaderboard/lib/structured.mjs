// Builds JSON-LD structured data per scenario type.
// Players are encouraged to do better in their own submissions.

export function structuredDataFor(scenario, candidate) {
  if (scenario.id === "carryon") return productJsonLd(candidate);
  if (scenario.id === "dental") return localBusinessJsonLd(candidate);
  if (scenario.id === "aeo-tool") return softwareJsonLd(candidate);
  return null;
}

function productJsonLd(c) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: c.name,
    category: "Carry-on travel backpack"
  };
}

function localBusinessJsonLd(c) {
  return {
    "@context": "https://schema.org",
    "@type": "Dentist",
    name: c.name,
    areaServed: "Austin, TX"
  };
}

function softwareJsonLd(c) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: c.name,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web"
  };
}

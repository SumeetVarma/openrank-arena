// Single source of truth for scenarios.
// Routes, the harness, and the leaderboard UI all read from this.

export const scenarios = {
  carryon: {
    id: "carryon",
    label: "Carry-on Travel Backpack",
    shortLabel: "Carry-on",
    category: "Consumer product",
    buyerQuery: "I need a carry-on travel backpack around $200 for a 10-day trip. Comfortable, organized, durable. What do you recommend?",
    underdog: {
      slug: "wayfare-42",
      name: "Wayfare 42",
      baselineFile: "carryon.md"
    },
    incumbents: [
      { slug: "voyager-pro-40", name: "Voyager Pro 40", baselineFile: "incumbent_tortuga.md" },
      { slug: "roamcore", name: "Roamcore Travel Pack", baselineFile: "incumbent_nomatic.md" }
    ],
    notes: "Underdog Wayfare 42 is cloned from Topo Designs' Global Pro Backpack. Incumbents are Tortuga + Nomatic real product pages."
  },
  dental: {
    id: "dental",
    label: "Family Dentist in Austin, TX",
    shortLabel: "Dental",
    category: "Local service",
    buyerQuery: "I just moved to Austin and need a family dentist. Looking for someone gentle, accepts most insurance, can see us in the next couple weeks. Who should I go to?",
    underdog: {
      slug: "maple-street-dental",
      name: "Maple Street Dental",
      baselineFile: "dental.md"
    },
    incumbents: [
      { slug: "cedar-hill", name: "Cedar Hill Family Dentistry", baselineFile: "incumbent_blunn.md" },
      { slug: "parmer-lane", name: "Parmer Lane Family Dentistry", baselineFile: "incumbent_nw.md" }
    ],
    notes: "Local-service scenario. Test of local-fit AEO against two established Austin practices."
  },
  "aeo-tool": {
    id: "aeo-tool",
    label: "OpenRank",
    shortLabel: "OpenRank",
    category: "AI Search Visibility · B2B SaaS",
    buyerQuery: "I run marketing at a 40-person startup. I need a tool to track — and improve — how my brand shows up in ChatGPT, Perplexity, and Gemini. What should I use?",
    underdog: {
      slug: "openrank",
      name: "OpenRank",
      baselineFile: "aeo-tool.md"
    },
    incumbents: [
      { slug: "lumen-aeo", name: "Lumen AEO", baselineFile: "incumbent_profound.md" },
      { slug: "vantage-ai", name: "Vantage AI", baselineFile: "incumbent_hall.md" }
    ],
    notes: "Meta-scenario — an AEO tool competing with two established AEO/SEO platforms."
  }
};

export const scenarioList = Object.values(scenarios);
export const scenarioIds = Object.keys(scenarios);

export function getScenario(id) {
  return scenarios[id] || null;
}

export function getCandidate(scenarioId, slug) {
  const s = scenarios[scenarioId];
  if (!s) return null;
  if (s.underdog.slug === slug) return { ...s.underdog, kind: "underdog" };
  const inc = s.incumbents.find((c) => c.slug === slug);
  return inc ? { ...inc, kind: "incumbent" } : null;
}

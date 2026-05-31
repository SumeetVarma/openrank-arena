// Single source of truth for scenarios.
// Routes, the harness, and the leaderboard UI all read from this.

export const scenarios = {
  carryon: {
    id: "carryon",
    label: "Carry-on Travel Backpack",
    category: "Consumer product",
    buyerQuery: "I need a carry-on travel backpack under $200 for a 10-day trip. Comfortable, organized, durable. What do you recommend?",
    underdog: {
      slug: "wayfare-42",
      name: "Wayfare 42",
      baselineFile: "carryon.md"
    },
    incumbents: [
      { slug: "voyager-pro-40", name: "Voyager Pro 40", baselineFile: "incumbent_tortuga.md" },
      { slug: "apex-30l", name: "Apex Travel Backpack 30L", baselineFile: "incumbent_peak.md" },
      { slug: "roamcore", name: "Roamcore Travel Pack", baselineFile: "incumbent_nomatic.md" },
      { slug: "andina-35l", name: "Andina 35L Travel Pack", baselineFile: "incumbent_cotopaxi.md" }
    ],
    notes: "The underdog is a real #10-class product (Topo Designs Global Travel Bag) with known weak spots: small laptop sleeve, subpar harness, low airline compliance. Real headroom for AEO."
  },
  dental: {
    id: "dental",
    label: "Family Dentist in Austin, TX",
    category: "Local service",
    buyerQuery: "I just moved to Austin and need a family dentist. Looking for someone gentle, accepts most insurance, can see us in the next couple weeks. Who should I go to?",
    underdog: {
      slug: "maple-street-dental",
      name: "Maple Street Dental",
      baselineFile: "dental.md"
    },
    incumbents: [
      { slug: "cedar-hill", name: "Cedar Hill Family Dentistry", baselineFile: "incumbent_blunn.md" },
      { slug: "cameron-road", name: "Cameron Road Family Dentistry", baselineFile: "incumbent_mm.md" },
      { slug: "parmer-lane", name: "Parmer Lane Family Dentistry", baselineFile: "incumbent_nw.md" },
      { slug: "westlake-family", name: "Westlake Family Dental", baselineFile: "incumbent_broberg.md" }
    ],
    notes: "Local-service scenario. Underdog only has weekday hours and a smaller team. Incumbents have wider hours, more reviews, broader insurance language. Test of local-fit AEO."
  },
  "aeo-tool": {
    id: "aeo-tool",
    label: "AI Search Visibility Platform",
    category: "B2B SaaS",
    buyerQuery: "I run marketing at a 40-person startup. I need a tool to track how my brand shows up in ChatGPT, Perplexity, and Gemini. What should I use?",
    underdog: {
      slug: "openrank",
      name: "OpenRank",
      baselineFile: "aeo-tool.md"
    },
    incumbents: [
      { slug: "lumen-aeo", name: "Lumen AEO", baselineFile: "incumbent_profound.md" },
      { slug: "vantage-ai", name: "Vantage AI", baselineFile: "incumbent_hall.md" },
      { slug: "beacon-search", name: "Beacon Search", baselineFile: "incumbent_brightedge.md" }
    ],
    notes: "Meta-scenario — an AEO tool competing with established AEO/SEO platforms. Underdog has the cleanest feature breakdown but the weakest social proof. Test of category framing."
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

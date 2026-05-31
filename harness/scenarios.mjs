// Mirrors leaderboard/lib/scenarios.mjs. Kept here so the CLI harness doesn't
// import out of the leaderboard package.

export const scenarios = {
  carryon: {
    id: "carryon",
    label: "Carry-on Travel Backpack",
    buyerQuery:
      "I need a carry-on travel backpack under $200 for a 10-day trip. Comfortable, organized, durable. What do you recommend?",
    underdog: { slug: "wayfare-42", name: "Wayfare 42" },
    incumbents: [
      { slug: "voyager-pro-40", name: "Voyager Pro 40" },
      { slug: "apex-30l", name: "Apex Travel Backpack 30L" },
      { slug: "roamcore", name: "Roamcore Travel Pack" },
      { slug: "andina-35l", name: "Andina 35L Travel Pack" }
    ]
  },
  dental: {
    id: "dental",
    label: "Family Dentist in Austin, TX",
    buyerQuery:
      "I just moved to Austin and need a family dentist. Looking for someone gentle, accepts most insurance, can see us in the next couple weeks. Who should I go to?",
    underdog: { slug: "maple-street-dental", name: "Maple Street Dental" },
    incumbents: [
      { slug: "cedar-hill", name: "Cedar Hill Family Dentistry" },
      { slug: "cameron-road", name: "Cameron Road Family Dentistry" },
      { slug: "parmer-lane", name: "Parmer Lane Family Dentistry" },
      { slug: "westlake-family", name: "Westlake Family Dental" }
    ]
  },
  "aeo-tool": {
    id: "aeo-tool",
    label: "AI Search Visibility Platform",
    buyerQuery:
      "I run marketing at a 40-person startup. I need a tool to track how my brand shows up in ChatGPT, Perplexity, and Gemini. What should I use?",
    underdog: { slug: "openrank", name: "OpenRank" },
    incumbents: [
      { slug: "lumen-aeo", name: "Lumen AEO" },
      { slug: "vantage-ai", name: "Vantage AI" },
      { slug: "beacon-search", name: "Beacon Search" }
    ]
  }
};

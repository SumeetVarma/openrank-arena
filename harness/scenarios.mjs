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
      { slug: "roamcore", name: "Roamcore Travel Pack" }
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
      { slug: "parmer-lane", name: "Parmer Lane Family Dentistry" }
    ]
  },
  "aeo-tool": {
    id: "aeo-tool",
    label: "OpenRank",
    buyerQuery:
      "I run marketing at a 40-person startup. I need a tool to track how my brand shows up in ChatGPT, Perplexity, and Gemini. What should I use?",
    underdog: { slug: "openrank", name: "OpenRank" },
    incumbents: [
      { slug: "lumen-aeo", name: "Lumen AEO" },
      { slug: "vantage-ai", name: "Vantage AI" }
    ]
  }
};

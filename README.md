# OpenRank Arena

A closed-arena Answer Engine Optimization (AEO) benchmark for a friend group of five.
We're practicing AEO so we can build an AEO company. This is the practice rink.

## What this is

Three scenarios. Each scenario has:
- One **underdog** page (a real ~#10-ranked page, brand name spoofed)
- Three or four **incumbent** pages (the top-ranked competition, also spoofed)
- A natural buyer query the AI judge asks

Players upload optimized HTML+assets for the underdog. The judge fetches all candidate pages
(player submissions + spoofed incumbents) and answers the buyer query as if it were just
helping a friend shop. Best AEO machinery wins.

## Scenarios

| Scenario | Underdog | Incumbents |
|---|---|---|
| Carry-on backpack | Wayfare 42 | Voyager Pro 40, Apex 30L, Roamcore, Andina 35L |
| Family dentist (Austin) | Maple Street Dental | Cedar Hill, Cameron Road, Parmer Lane, Westlake Family |
| AI visibility platform | OpenRank | Lumen AEO, Vantage AI, Beacon Search |

The names are fictional. The page content is copied verbatim from real ~#10 and top-ranked
pages in each category; only brand names are swapped. Repo is private.

## Repo layout

```
openrank-arena/
├── README.md
├── baselines/                # markdown source of every candidate page
│   ├── underdog/             # the 3 underdog starting points
│   └── shared/<scenario>/    # incumbent pages per scenario
├── harness/                  # judge prompt + scoring + CLI runner
│   ├── judge.mjs             # closed-set, ordering-neutral judge prompt
│   ├── fetch-candidates.mjs  # pulls live pages from the Vercel app
│   ├── providers/            # anthropic.mjs, openai.mjs (pluggable)
│   ├── scenarios.mjs         # scenario manifest (mirror)
│   └── run-judge.mjs         # CLI entry point
├── leaderboard/              # Next.js 15 app on Vercel
│   ├── app/
│   │   ├── page.jsx                          # home / leaderboard
│   │   ├── submit/                           # zip-upload submission form
│   │   ├── baseline/[scenario]/              # rendered baseline page + /llms.txt
│   │   ├── incumbents/[scenario]/[slug]/     # rendered incumbent page + /llms.txt
│   │   ├── players/[name]/                   # player profile
│   │   ├── players/[name]/[scenario]/        # latest submission, rendered
│   │   ├── players/[name]/[scenario]/v/[v]/  # any historical version
│   │   ├── players/[name]/[scenario]/llms.txt
│   │   ├── players/[name]/[scenario]/assets/[...path]/
│   │   └── api/
│   │       ├── submit/                       # zip upload → Blob + KV
│   │       └── feedback/                     # notes feed
│   ├── lib/
│   │   ├── scenarios.mjs       # scenario manifest
│   │   ├── baseline.mjs        # md → html for baselines
│   │   ├── llmstxt.mjs         # auto-generate llms.txt
│   │   ├── structured.mjs      # JSON-LD per scenario type
│   │   ├── storage.mjs         # Vercel KV + Blob wrappers (in-memory fallback)
│   │   ├── submissionAssets.mjs # extract zip files on demand
│   │   └── submissionHtml.mjs  # split player <head>/<body>
│   └── package.json
├── submission-template/      # what a player's zip should look like
└── docs/
    ├── HOW-IT-WORKS.md
    ├── JUDGE-PROMPT.md       # the actual judge prompt, openly published
    └── RULES.md              # truthfulness, no-cheat
```

## How a player submits

Two ways, both work the same backend.

### Option A — From the website
1. Visit https://openrank-arena.vercel.app/
2. "Claim a name" → seeds a v1 from the baseline
3. Iterate locally → upload a new zip via `/submit`

### Option B — From the CLI (LLM-friendly)
Designed so you can tell Claude / Codex / Cursor "submit my page" and it just runs:

```bash
# 1. Claim a name (creates a v1 seeded from the baseline)
node harness/start.mjs --name alice --scenario carryon

# 2. Iterate on a local folder with at least index.html
mkdir alice-carryon && cd alice-carryon
curl -O https://openrank-arena.vercel.app/baseline/carryon/starter.zip
unzip starter.zip
# ...edit index.html, llms.txt, add assets/...

# 3. Submit (creates a new version, becomes live immediately)
node harness/submit.mjs --name alice --scenario carryon --dir ./alice-carryon \
  --note "tightened headings, added FAQ"
```

Every submission becomes a new version. The latest is what shows on the leaderboard;
old versions stay browseable at `/players/<name>/<scenario>/v/<version>`.

See [`submission-template/`](./submission-template/) for an example zip layout.

## Running the judge

```bash
cd leaderboard
npm install
# set env vars from .env.example
npm run dev      # http://localhost:3000

# in another terminal
cd harness
ARENA_BASE_URL=http://localhost:3000 \
ANTHROPIC_API_KEY=sk-... \
node run-judge.mjs --scenario carryon --players alice,bob,sumeet
```

Output: the judge's plain-language recommendation, the labeled candidate map, the parsed JSON,
and per-player scores.

## What "winning" looks like

For any given run, each candidate is labeled A/B/C... in random order. The judge:
1. Picks the buyer's recommendation
2. Ranks all candidates
3. Flags any claims it made that weren't supported by the page text

Score = position score + pick bonus, then capped at 0.5 if you fabricated about your own page.

The point isn't a single high score. The point is: which AEO playbook generalizes across
scenarios? After 5 of us iterate on this for a couple weeks, we should know what works.

## Deploy

This is intended to live at `openrank-arena.vercel.app`. Provision:
- Vercel KV (for player + submission + score metadata)
- Vercel Blob (for submitted zips)
- Anthropic and/or OpenAI API key

See [`leaderboard/.env.example`](./leaderboard/.env.example).

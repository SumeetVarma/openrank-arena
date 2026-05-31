---
name: openrank-match
description: Run a match for OpenRank Arena — judge 2+ entrants for a scenario and post the result so Elo updates. Use when the user says "run a match", "judge my page against baseline", "play alice vs bob on carryon", "score my submission". You do the judging yourself (no API key needed); a tiny script uploads the verdict.
metadata:
  argument-hint: "[scenario] [entrants...]"
---

# Run a match in OpenRank Arena

A "match" is one ranked judgment over 2+ entrants for a single scenario. The
result posts to `/api/match` so Elo lands on the live leaderboard at
https://openrank-arena.vercel.app.

You — the assistant — are the LLM judge. You read the entrant pages, you
produce the ranking + rationale. A thin script uploads the JSON. No API
key, no separate provider.

## Entrants

- A **player name** — `alice`, `sumeet`, etc. Uses their latest submission.
- `baseline` — the unedited underdog page (the spoofed #10 page).
- An **incumbent slug** — pre-existing market competitors:
  - `carryon`: `voyager-pro-40`, `roamcore`
  - `dental`: `cedar-hill`, `parmer-lane`
  - `aeo-tool`: `lumen-aeo`, `vantage-ai`

Mix freely. 2 entrants = pairwise duel. 3+ = N-way ranking.

## The flow

### 1. Pick scenario + entrants

Ask if not given. Default suggestion for a new player: `<name>,baseline`.
Use the `--all` switch (in `harness/match.mjs`) only if the user wants the
whole field at once.

### 2. Fetch the entrant pages

For each entrant, fetch the rendered HTML from the live site:

- Player: `https://openrank-arena.vercel.app/players/<name>/<scenario>`
- Baseline: `https://openrank-arena.vercel.app/baseline/<scenario>`
- Incumbent: `https://openrank-arena.vercel.app/incumbents/<scenario>/<slug>`

Use the WebFetch tool. Read each one fully.

### 3. Confirm entrants exist

If a player name doesn't have a submission, the GET will return a "no
submission yet" stub. Catch that and tell the user — don't try to judge an
empty page.

### 4. Judge as the buyer's friend

Use this exact framing — it's the same one `harness/match.mjs` uses, so the
judging stays consistent regardless of who's running it:

> You're helping a friend make a real buying decision. They asked:
> "<scenario.buyerQuery>"
>
> You pulled up N candidate pages an AI answer engine surfaced. Pages are
> in random order; order does not reflect relevance.
>
> Some pages describe the same lesser-known underdog (anonymized to a single
> placeholder name so brand familiarity doesn't bias you). Other pages are
> for established competitors in the category. Don't try to guess which is
> which — judge each page on its own merits.

The buyer queries:

- `carryon`: "I need a carry-on travel backpack around $200 for a 10-day
  trip. Comfortable, organized, durable. What do you recommend?"
- `dental`: "I just moved to Austin and need a family dentist. Looking for
  someone gentle, accepts most insurance, can see us in the next couple
  weeks. Who should I go to?"
- `aeo-tool`: "I run marketing at a 40-person startup. I need a tool to
  track — and improve — how my brand shows up in ChatGPT, Perplexity, and
  Gemini. What should I use?"

Evaluate on:

- **Answer clarity & heading structure**
- **Concrete specifics** (price, dimensions, hours, features that matter)
- **Structured claims** (schema, machine-readable specs)
- **Honest fit framing** — does the page surface buyer-relevant claims
  first? does it concede where it isn't a fit?
- **Truthfulness** — fabricated reviews, awards, integrations, or prices
  are an automatic rank drop. Don't be lazy about this.

Be honest. Ties are allowed but rare — prefer to pick a winner.

### 5. Write the result JSON

Produce a single JSON object with this shape:

```json
{
  "scenarioId": "carryon",
  "ranking": ["alice", "baseline"],
  "entrantKinds": { "alice": "player", "baseline": "baseline" },
  "rationale": "One paragraph (≤4 sentences) explaining the call. Be specific about WHAT made the winner more credible.",
  "signals": [
    { "signal": "clarity_of_answer",  "best": "alice",    "worst": "baseline" },
    { "signal": "concrete_specifics", "best": "alice",    "worst": "baseline" },
    { "signal": "structured_claims",  "best": "baseline", "worst": "alice" },
    { "signal": "honest_fit",         "best": "alice",    "worst": "baseline" },
    { "signal": "truthfulness",       "best": "alice",    "worst": "baseline" }
  ],
  "model": "claude-in-the-loop"
}
```

- `ranking` is most credible → least credible
- `entrantKinds` maps each label to `"player"`, `"baseline"`, or `"incumbent"`
- `rationale` shows up in the match record and the recent activity feed
- `signals` is optional but useful — entrant labels are used directly (not
  letters A/B/C)

Write it to a temp file or pipe it to stdin in the next step.

### 6. Upload the result

```bash
node harness/score-submit.mjs --result /tmp/match-result.json
```

…or pipe stdin:

```bash
echo '{...}' | node harness/score-submit.mjs --result -
```

The script prints the match id, ranking, and Elo deltas for each entrant.
Surface those back to the user.

### 7. Tell them where to look

After it posts, the result is visible at:

- https://openrank-arena.vercel.app/#leaderboard (updated standings)
- https://openrank-arena.vercel.app/ (most recent activity feed)

## What NOT to do

- **Don't ask the user to paste a prompt anywhere.** You are the judge.
- **Don't run `harness/match.mjs`.** That path needs API keys. Use the
  fetch-judge-upload path instead.
- **Don't fabricate entrants.** Verify they exist (fetch their page) before
  including them in a ranking.
- **Don't be soft on truthfulness.** If a page invents a review, a rating,
  a partnership, or a price that you can't corroborate from the content
  itself — drop its rank and call it out in the rationale.
- **Don't quietly average ties.** Ties should be in the ranking as same-
  position entries (e.g. `["alice", "alice", "bob"]` is wrong; if alice
  and bob tie, list them and mention it in the rationale).

## Examples

User: "judge my dental page against the incumbents"
→ Ask their name. Fetch their dental page + `/baseline/dental` +
`/incumbents/dental/cedar-hill` + `/incumbents/dental/parmer-lane`.
Rank them. Write JSON. Run `score-submit.mjs`.

User: "score sumeet vs alice on aeo-tool"
→ Fetch both pages. Judge. Upload.

User: "run a match for carryon"
→ Ask who's in it. If they want everyone, fetch the player list:
`curl https://openrank-arena.vercel.app/api/players?scenario=carryon`,
then judge them all together.

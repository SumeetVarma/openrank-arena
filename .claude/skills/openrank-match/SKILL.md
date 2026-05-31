---
name: openrank-match
description: Run a match for OpenRank Arena — judge 2+ entrants for a scenario and post the result so Elo updates. Use when the user says "run a match", "judge my page against baseline", "play alice vs bob on carryon", "score my submission". A blinded subagent does the judging; this outer flow handles the bookkeeping.
metadata:
  argument-hint: "[scenario] [entrants...]"
---

# Run a match in OpenRank Arena

A "match" is one ranked judgment over 2+ entrants for a single scenario. The
result posts to `/api/match` so Elo lands on the live leaderboard at
https://openrank-arena.vercel.app.

**Reliability is the whole point of this skill.** A match is only worth running
if the judge can't tell which page belongs to whom. This skill enforces that
with four rules below. Don't relax any of them.

---

## Reliability rules (NOT optional)

### Rule 1 — A separate judge

**You (the assistant invoking this skill) MUST NOT be the judge.** The judge
runs in a fresh subagent (Claude Code's Task tool, `general-purpose` agent)
that has no codebase context, no prior conversation, and no access to the
authorship map.

The judge subagent only sees:
- the scenario buyer query
- the labeled page contents (`Page A`, `Page B`, …)
- the judging rubric below

It returns ranking by **letter only**. You remap to names afterward.

### Rule 2 — Anonymized labels

When you build the judge prompt, generate a fresh random permutation of
letters `A`, `B`, `C`, … one per entrant. Keep the secret map locally
(`{ "A": "alice", "B": "baseline", "C": "voyager-pro-40" }`). The map is
never passed to the judge subagent.

The judge prompt MUST refer to pages as `Page A`, `Page B`, etc. — never by
player name, never by URL, never by file path.

### Rule 3 — No author self-judging

Before running, ask the user: "Are any of the entrants pages YOU wrote in
this session?" If yes, refuse and tell them to run the match from a fresh
session (or a different player's machine). This is honor-system but it's
the single most important rule — surface it loudly.

### Rule 4 — At least 3 matches per invocation

A single judge call is too noisy — both because the LLM is stochastic and
because label-shuffle position can bias ranking. Run the same matchup **at
least 3 times**, each time with a freshly randomized A/B/C/D shuffle, each
in its own fresh subagent. Upload each result separately via
`score-submit.mjs` so Elo accumulates across the 3 independent judgments.

This means: for a 2-entrant duel, you make 3 subagent calls → 3 uploads →
3 Elo updates. The leaderboard reflects the *aggregate* signal, not one
sample.

After all 3 run, surface a summary: how many times each entrant won, and
the final Elo deltas summed across the 3.

---

## Entrants

- A **player name** — `alice`, `sumeet`. Uses their latest submission.
- `baseline` — the unedited underdog page (the spoofed #10 page).
- An **incumbent slug**:
  - `carryon`: `voyager-pro-40`, `roamcore`
  - `dental`: `cedar-hill`, `parmer-lane`
  - `aeo-tool`: `lumen-aeo`, `vantage-ai`

Mix freely. 2 entrants = pairwise duel. 3+ = N-way ranking.

---

## The flow

### Step 1 — Confirm scenario + entrants

Ask if not given. Default suggestion for a new player: `<name>,baseline`.

### Step 2 — Check Rule 3 (no self-judging)

Ask: "Are any of these entrants pages YOU just wrote or edited in this
session?" If yes → stop. Tell the user this match needs to run from a
fresh session or a different machine to avoid author bias.

### Step 3 — Pin every player entrant to a specific version, then fetch

**Critical for reproducibility.** A bare `/players/<name>/<scenario>` URL
serves whatever happens to be latest at fetch time — if the player submits
again mid-match, the judge could see a different page than what gets
recorded. Always pin.

For each **player** entrant: hit
`https://openrank-arena.vercel.app/api/players?scenario=<scenario>&name=<name>`
to read `latestVersion`. Capture it. Then fetch the versioned page:

  `https://openrank-arena.vercel.app/players/<name>/<scenario>/v/<version>`

For baseline + incumbents (which don't change):
- Baseline: `https://openrank-arena.vercel.app/baseline/<scenario>`
- Incumbent: `https://openrank-arena.vercel.app/incumbents/<scenario>/<slug>`

Build a local `entrantVersions` map that you'll pass through to
`score-submit.mjs`:
```js
const entrantVersions = { alice: "01e197da" }; // only players go here
```

If a player has no submission yet (`hasSubmission: false` or
`latestVersion: null`), abort — you can't judge an empty entrant.

### Step 3b — Result payload shape (reference)

Each per-iteration result file must look like this:

```json
{
  "scenarioId": "carryon",
  "ranking": ["alice", "baseline"],
  "entrantKinds":    { "alice": "player",  "baseline": "baseline" },
  "entrantVersions": { "alice": "01e197da" },
  "rationale": "Page A surfaced concrete specs first and conceded weaknesses; Page B buried the answer in marketing copy.",
  "signals": [
    { "signal": "clarity_of_answer", "best": "alice", "worst": "baseline" }
  ],
  "model": "claude-blinded-subagent"
}
```

`entrantVersions` only contains player entrants. Baselines and incumbents
don't need pinning (they're fixed assets).

### Step 4 — Build the anonymized prompt

Generate a random letter assignment:

```js
// pseudo: shuffle ["A","B","C",...] across entrants
const labels = shuffle(["A", "B", "C", "D"].slice(0, entrants.length));
const labelMap = {}; // secret: { "A": "alice", "B": "baseline", ... }
entrants.forEach((name, i) => { labelMap[labels[i]] = name; });
```

Then assemble the judge prompt. Use this exact framing — it's the same one
`harness/match.mjs` uses, so judgments stay consistent regardless of who's
running:

> You're helping a friend make a real buying decision. They asked:
>
> > "<scenario.buyerQuery>"
>
> You pulled up N candidate pages an AI answer engine surfaced. Pages are
> in random order; order does not reflect relevance.
>
> Some pages describe the same lesser-known underdog (anonymized to a single
> placeholder name so brand familiarity doesn't bias you). Other pages are
> for established competitors in the category. Don't try to guess which is
> which — judge each page on its own merits.
>
> ### Page A
>
> <page A content, max 5000 chars>
>
> ---
>
> ### Page B
>
> <page B content, max 5000 chars>
>
> ---
>
> Rank all N pages from MOST credible to LEAST credible — which would most/least likely earn the buyer's recommendation.
>
> Evaluate on:
> - Answer clarity & heading structure
> - Concrete specifics (price, dimensions, hours, features that matter)
> - Structured claims (schema, machine-readable specs)
> - Honest fit framing — does it surface buyer-relevant claims first? does it concede where it isn't a fit?
> - Truthfulness — fabricated reviews, awards, integrations, or prices = automatic rank drop
>
> Be honest. Ties allowed but rare — prefer to pick a winner.
>
> Output a single JSON object on the final line:
>
> ```json
> { "ranking": ["A","B","C"], "rationale": "one paragraph why", "signals": [...] }
> ```

The buyer queries:
- `carryon`: "I need a carry-on travel backpack around $200 for a 10-day trip. Comfortable, organized, durable. What do you recommend?"
- `dental`: "I just moved to Austin and need a family dentist. Looking for someone gentle, accepts most insurance, can see us in the next couple weeks. Who should I go to?"
- `aeo-tool`: "I run marketing at a 40-person startup. I need a tool to track — and improve — how my brand shows up in ChatGPT, Perplexity, and Gemini. What should I use?"

### Step 5 — Fire 3 blinded matches IN PARALLEL (Rule 4)

The 3 iterations are independent — different shuffle, different subagent,
different upload. **Fire all 3 subagent calls in the same message** so they
run concurrently instead of sequentially. This is fast.

For **i = 1, 2, 3** (minimum 3 — more if the user asks):

  **5a (do all three up front).** Generate 3 distinct random A/B/C/D
  shuffles. Three labelMaps locally. Verify they differ pairwise (re-shuffle
  if any two collide).

  **5b (single message, 3 Task tool calls).** Spawn 3 Task subagents in
  parallel, each with `subagent_type: general-purpose`, each receiving the
  prompt assembled with that iteration's shuffle. Subagents run in isolated
  fresh sessions — no access to this conversation, this codebase, or any
  label map.

  Example (pseudocode):
  ```
  [parallel]
  Task(subagent_type=general-purpose, prompt=promptWithShuffle1)
  Task(subagent_type=general-purpose, prompt=promptWithShuffle2)
  Task(subagent_type=general-purpose, prompt=promptWithShuffle3)
  ```

  **5c (after all 3 return).** Parse each subagent's JSON output. For each:
  substitute letters back to names using its own labelMap_i.

  **5d (upload all 3, also in parallel).** Each result file MUST include
  `entrantVersions` mapping every player entrant to the version id captured
  in Step 3. The score-submit.mjs script will reject the payload otherwise.

  Run `score-submit.mjs` three times — independent POSTs fire concurrently:

  ```bash
  node harness/score-submit.mjs --result /tmp/match-result-1.json
  node harness/score-submit.mjs --result /tmp/match-result-2.json
  node harness/score-submit.mjs --result /tmp/match-result-3.json
  ```

  Each call returns a match id and Elo deltas for that iteration.

You now have 3 independent Elo updates pushed to the live leaderboard, each
from a freshly-shuffled, blinded subagent — and the whole thing took roughly
the wall-time of one match because everything ran in parallel.

### Step 6 — Summarize for the user

Report:
- How many times each entrant won across the 3 runs (e.g. "alice 3-0
  baseline" or "alice 2-1 baseline")
- Final Elo deltas (sum across the 3 uploads)
- Match ids (3 of them, all visible in Recent activity)

If the 3 verdicts disagreed (split decision), call that out — it means the
matchup is genuinely close and the user should keep iterating.

### Step 7 — Tell them where to look

- https://openrank-arena.vercel.app/#leaderboard
- https://openrank-arena.vercel.app/ (recent activity)

---

## What NOT to do

- **Don't judge in-thread.** You have context the judge shouldn't see. Always
  dispatch to a subagent (Step 5).
- **Don't leak names in the prompt.** Every reference to an entrant in the
  judge prompt must be by letter. No "alice", no `/players/alice/...`, no
  filenames. URLs are stripped before fetching is done.
- **Don't fabricate entrants.** Verify they exist (fetch their page) before
  including them in a ranking.
- **Don't be soft on truthfulness.** If a page invents a review, a rating,
  a partnership, or a price that you can't corroborate from the content
  itself — drop its rank and call it out in the rationale.
- **Don't quietly average ties.** Ties go in the ranking as same-position
  entries and get mentioned in the rationale.

---

## Examples

User: "judge my dental page against the incumbents"
→ Confirm Rule 3 (did they write it this session?). If they ran it from a
fresh session: fetch each page → shuffle to A/B/C/D → spawn blinded
subagent → remap → upload.

User: "score sumeet vs alice on aeo-tool"
→ Confirm neither was written by the current session. Same blinded flow.

User: "I just wrote my carryon page, judge it"
→ Refuse. Tell them: start a fresh Claude Code session and run the match
from there. Author self-judging biases the result.

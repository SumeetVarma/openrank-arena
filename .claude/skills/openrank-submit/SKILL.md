---
name: openrank-submit
description: Submit a page to OpenRank Arena (the AEO benchmark at openrank-arena.vercel.app). Use when the user says "submit my page", "upload to the arena", "ship my carryon submission", or similar. Handles scenario selection, zip packaging, and the API call.
metadata:
  argument-hint: "[scenario] [path]"
---

# Submit to OpenRank Arena

This skill ships a player's HTML+assets page to the arena leaderboard.

## What the arena is

OpenRank Arena (https://openrank-arena.vercel.app) is a closed AEO benchmark.
There are three scenarios:

- `carryon` — Wayfare 42 (consumer product: carry-on backpack)
- `dental` — Maple Street Dental (local service: family dentist in Austin, TX)
- `aeo-tool` — OpenRank (B2B SaaS: AI search visibility tool)

Each scenario has an underdog page ranked ~#10 in Search. Players rewrite the
page to be more credible to an LLM-judge and earn Elo on the leaderboard.

## The flow

1. **Confirm scenario.** If the user didn't say, ask which of `carryon`,
   `dental`, `aeo-tool` they're submitting for.
2. **Confirm the source directory.** Default: the current working directory,
   or whatever path the user named. It must contain at minimum `index.html`.
   Recommended also: `llms.txt`, `assets/`.
3. **Confirm their name.** First submission claims it; future submissions
   under the same name overwrite (versioned). Names are kebab-cased
   `[a-zA-Z0-9_-]+`.
4. **Optional note.** A one-liner describing what they tried this version. Up
   to 280 chars. Shows up in the recent-submissions feed.
5. **Run the CLI.** Use the harness script that already exists in this repo:

   ```bash
   node harness/submit.mjs \
     --name <name> \
     --scenario <scenario> \
     --dir <path-to-source-folder> \
     --note "<optional one-liner>" \
     --base-url https://openrank-arena.vercel.app
   ```

6. **Report the result.** The CLI prints the live URL, version id, and player
   profile URL. Surface those back to the user as clickable links. The
   leaderboard updates immediately.

7. **Auto-match on first submit in this scenario.** After the upload succeeds,
   check whether the player already has any judged match for this scenario:

   ```bash
   curl -s "https://openrank-arena.vercel.app/api/players?scenario=<scenario>&name=<name>"
   ```

   The response shape:

   ```json
   { "name": "...", "scenario": "...", "elo": 1016, "duels": 1, "hasSubmission": true, ... }
   ```

   - If `duels === 0` → tell the user "this is your first submission in this
     scenario; let me run one match against baseline so you get a real Elo."
     Then invoke `/openrank-match` with `<name>,baseline` as entrants. The
     `/openrank-match` skill does the judging in-thread (no API key) and
     posts the result via `harness/score-submit.mjs`.

   - If `duels > 0` → tell the user their previous Elo (`elo`) stands. Don't
     auto-run a fresh match. Tell them they can run `/openrank-match` when
     they're ready to challenge again.

   This is announced, not hidden — say what you're about to do before doing it.

8. **Where the scores live.** Everyone shares one source of truth: the
   Upstash KV behind `https://openrank-arena.vercel.app`. No local files,
   no gitignored state. Every submit/match writes there; every page read
   pulls from there. So whatever score the skill sees is the same score
   every player sees.

## Where to find the harness

If `harness/submit.mjs` is NOT in the current repo, this user has copied the
skill without the codebase. Fall back to posting a multipart POST to
`https://openrank-arena.vercel.app/api/submit` with form fields:

- `name` (string)
- `scenario` (string, one of the three)
- `zip` (a zip blob containing `index.html` + optional siblings)
- `note` (optional string)

A 200 response means it shipped. The JSON body has `{ url, version, profileUrl }`.

## What NOT to do

- Don't write a fresh page yourself. The user already has one — find it and
  zip it. If they ask for help writing one, that's a different skill.
- Don't expose any secrets. The submit endpoint is open; no auth required.
- Don't run a match after submitting. That's `/openrank-match`. Just confirm
  the submission landed.
- Don't fabricate the result. If the CLI errors, surface the error verbatim.

## Examples

User: "submit this folder to the arena under name `sumeet` for carryon"
→ Verify `index.html` exists in the folder, run the CLI with those args,
report the URL.

User: "ship my submission"
→ Ask which scenario, ask their name, ask which folder. Then run.

User: "redo the maple street dental one"
→ Ask their name + path, set scenario=dental, run.

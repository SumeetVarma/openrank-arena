# Contributing to OpenRank Arena

Thanks for wanting to make this better. The arena lives at
https://openrank-arena.vercel.app and the source lives here. Both are public.

## How to contribute

We use the standard fork → PR workflow. No Vercel team seat required — you
only need a GitHub account.

1. **Fork** this repository on GitHub.
2. **Clone** your fork locally:

   ```bash
   git clone https://github.com/<your-username>/openrank-arena.git
   cd openrank-arena
   ```

3. **Branch** off `main`:

   ```bash
   git switch -c your-feature-name
   ```

4. **Install + run**:

   ```bash
   cd leaderboard
   npm install
   npm run dev
   ```

   The dev server runs at http://localhost:3000. The dev build talks to the
   live Upstash KV (read-only by default — you'll need `KV_REST_API_URL` and
   `KV_REST_API_TOKEN` env vars to test writes, ask the maintainer).

5. **Make your change.** Keep the diff focused. Don't reformat unrelated files.

6. **Verify**:

   ```bash
   cd leaderboard
   npm run build   # must pass
   ```

7. **Commit + push** to your fork:

   ```bash
   git add -A
   git commit -m "what changed and why"
   git push origin your-feature-name
   ```

8. **Open a Pull Request** from your fork's branch into this repo's `main`.

Once you open the PR, Vercel will automatically build a **preview
deployment** at a unique URL. The maintainer can click that URL on the PR to
review your changes live before merging.

## What we'll accept

- Bug fixes (with a one-line reproduction in the PR description).
- New scenarios — add to `leaderboard/lib/scenarios.mjs` AND `harness/scenarios.mjs`, drop the underdog clone into `baselines/underdog-clone/<id>/`.
- UX polish to the home page, leaderboard, submit page, judge-prompt viewer.
- Skill improvements (`.claude/skills/openrank-*`).
- Better judge prompts / scoring rubrics — but read `harness/match.mjs` first.

## What we won't accept (without discussion)

- Adding paid dependencies or upgrading the runtime.
- Anything that requires you on the Vercel team (we keep the project on the
  hobby plan).
- Wholesale design rewrites — open an issue first so we agree on direction.
- Code without context: please include 1-2 sentences in the PR description
  about *why* the change matters.

## Where issues go

Open one on GitHub: https://github.com/SumeetVarma/openrank-arena/issues

For ideas that aren't quite issues, the **Notes** section on the live site
(https://openrank-arena.vercel.app/#feedback) is the lighter-weight place —
everyone in the friend group sees those.

## Vercel + the hobby plan

This project runs on Vercel's free Hobby tier. To keep it that way:

- Contributors stay as PR authors only — they're never added to the Vercel
  team (that would trigger a seat fee).
- Preview deploys for PRs come from Vercel automatically; the maintainer
  reviews them on the PR before merging to `main` (which triggers the
  production deploy).
- If you need a long-running preview environment, fork the repo and link
  your fork to your own Vercel account.


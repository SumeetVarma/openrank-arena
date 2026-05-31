# How it works

## The arena

Closed set. The judge only ever sees a fixed pool of candidate pages for a given run:

- 1 underdog baseline (or, if a player has submitted, that player's latest submission replaces it)
- 3–4 spoofed incumbents (fixed per scenario)
- Any number of additional player submissions (each player adds 1 candidate per scenario)

Pages are shuffled and assigned letters A/B/C… The judge never sees player names, slugs,
or any "this is a submission" framing.

## The judge prompt

See [JUDGE-PROMPT.md](./JUDGE-PROMPT.md) for the verbatim prompt.

Design principles:
- **Buyer framing:** "You're helping a friend shop. They asked: …"
- **No leaderboard framing:** judge has no idea this is a scored benchmark
- **Order doesn't matter:** prompt explicitly says order does not reflect relevance
- **Closed set:** judge picks from the pages it's given; no open-web reasoning
- **Truthfulness:** prompt requires the judge to flag any claim it made that isn't in the page

## Scoring

For each candidate slug a run cares about (typically each player), the harness computes:

```
positionScore   = max(0, 1 − rankIndex/totalCandidates)
pickBonus       = 0.25 if the judge picked this slug as the recommendation
fabricated      = total count of fabrication_flags across all pages
fabAboutTarget  = count of fabricated claims about THIS slug's page
truthMultiplier = 0.5 if fabAboutTarget > 0 else 1.0
truthPenalty    = min(0.3, fabricated * 0.05)

score = clamp(0, (positionScore + pickBonus) * truthMultiplier − truthPenalty, 1.25)
```

The cap at 1.25 lets a clean #1 pick beat a #1 with minor cross-page fabrication.

## Hidden scenarios

Three public scenarios are not enough to be sure who's actually generalizing. We expect
the friend group to suggest hidden holdout scenarios via the feedback feed. Organizers
can rotate one of those into a private judge run periodically. If a player's AEO playbook
keeps winning on hidden scenarios, that's the real signal.

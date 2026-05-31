# Judge prompt (verbatim)

This is the actual prompt the judge model sees. Published openly so players can reason
about what the judge values.

```
You are helping a friend shop. They asked:

"{buyer_query}"

They pulled up the following pages and want your honest opinion. The pages are listed in
no particular order — order does not reflect relevance. Judge each on its own merits, based
only on what's actually written on the page. Do not assume facts that are not stated. Do not
invent prices, ratings, features, awards, or integrations.

---
**Page A:**

{content of page A}

---
**Page B:**

{content of page B}

---
... (one block per candidate)
---

First, write a short, plain-language recommendation to your friend (2-4 sentences): which
one should they go with, and why. Mention the trade-offs briefly. Be honest — if none of
the pages is a good fit, say so.

Then, on a new line, output a JSON object with this exact shape (and nothing after it):

```json
{
  "pick": "<page letter>",
  "ranking": ["<best>", "<second>", ...],
  "reasoning_per_page": {
    "<letter>": "one-sentence reason this page is or isn't a fit"
  },
  "fabrication_flags": {
    "<letter>": ["any claim you made about this page that is NOT supported by its text, or [] if none"]
  }
}
```

Important:
- "pick" must be one of the page letters.
- "ranking" must include every page letter exactly once, from best fit to worst fit.
- "fabrication_flags" tracks claims YOU made in your recommendation that are not grounded in
  the page text. If you didn't make any unsupported claims, leave the array empty.
```

## Notes on prompt design choices

- The buyer query is set per scenario (`scenarios.mjs`) and crafted to be realistic for a
  real shopper, not a benchmark prompt.
- Candidate ordering is randomized server-side every run. The "order doesn't matter" line
  is a second layer of protection against positional bias.
- The fabrication flag is the truthfulness gate. The scoring cap at 0.5 for self-fabrication
  keeps the underdog from winning by feeding the judge lies.

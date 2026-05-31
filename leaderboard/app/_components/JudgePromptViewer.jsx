"use client";

import { useState } from "react";

// Renders the exact match-judge prompt template the harness sends, with the
// per-scenario buyer query slotted in. Three scenarios → three tabs.

function buildPromptPreview(scenario) {
  return `You're helping a friend make a real buying decision. They asked:

> "${scenario.buyerQuery}"

You pulled up N candidate pages an AI answer engine surfaced. Pages are in random order; order does not reflect relevance.

Some pages describe the same lesser-known underdog (anonymized to a single placeholder name so brand familiarity doesn't bias you). Other pages are for established competitors in the category. Don't try to guess which is which — judge each page on its own merits.

### Page A

<full HTML of submission A>

---

### Page B

<full HTML of submission B>

---

Rank all N pages from MOST credible to LEAST credible — i.e., which would most/least likely earn the buyer's recommendation.

Evaluate on:
- Answer clarity & heading structure
- Concrete specifics (price, dimensions, hours, features the buyer cares about)
- Structured claims (schema, machine-readable specs)
- Honest fit framing (does the page surface buyer-relevant claims first, concede where it isn't a fit?)
- Truthfulness — fabricated reviews, awards, integrations, prices = automatic rank drop

Be honest. A tie is allowed if two entries are genuinely equivalent — but ties should be rare. Prefer to pick a winner.

Write 3–5 sentences explaining your call, then end with a JSON object:

\`\`\`json
{
  "ranking": ["A", "B", "C"],
  "rationale": "one-paragraph why",
  "signals_compared": [
    {"signal": "clarity_of_answer",  "best": "<letter>", "worst": "<letter>"},
    {"signal": "concrete_specifics", "best": "<letter>", "worst": "<letter>"},
    {"signal": "structured_claims",  "best": "<letter>", "worst": "<letter>"},
    {"signal": "honest_fit",         "best": "<letter>", "worst": "<letter>"},
    {"signal": "truthfulness",       "best": "<letter>", "worst": "<letter>"}
  ]
}
\`\`\``;
}

export default function JudgePromptViewer({ scenarios }) {
  const [activeId, setActiveId] = useState(scenarios[0]?.id);
  const active = scenarios.find((s) => s.id === activeId) || scenarios[0];

  return (
    <div className="judgePrompt">
      <div className="judgePromptHead">
        <div>
          <p className="eyebrow" style={{ marginBottom: 6 }}>The judge prompt</p>
          <h3 className="judgePromptTitle">What the LLM judge actually reads</h3>
          <p className="judgePromptSub">
            The same template runs for every match — only the buyer query differs.
            Truthfulness gets weighted hardest; fabricated claims are an automatic rank drop.
          </p>
        </div>
        <div className="promptTabs" role="tablist" aria-label="Judge prompt by scenario">
          {scenarios.map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={s.id === active.id}
              className={`promptTab ${s.id === active.id ? "is-active" : ""}`}
              onClick={() => setActiveId(s.id)}
              type="button"
            >
              {s.shortLabel}
            </button>
          ))}
        </div>
      </div>

      <pre className="judgePromptBody">{buildPromptPreview(active)}</pre>

      <p className="judgePromptFoot">
        Source:{" "}
        <a className="tlink" href="https://github.com/SumeetVarma/openrank-arena/blob/main/harness/match.mjs">
          harness/match.mjs
        </a>
      </p>
    </div>
  );
}

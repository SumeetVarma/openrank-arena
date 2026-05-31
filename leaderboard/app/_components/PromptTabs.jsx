"use client";

import { useState } from "react";

export default function PromptTabs({ scenarios }) {
  const [activeId, setActiveId] = useState(scenarios[0]?.id);
  const active = scenarios.find((s) => s.id === activeId) || scenarios[0];

  return (
    <div className="promptDemo">
      <div className="promptDemoHead">
        <div>
          <p className="eyebrow" style={{ marginBottom: 6 }}>The kind of question we&apos;re ranking for</p>
          <h3 className="promptDemoTitle">A real buyer asks an AI</h3>
        </div>
        <div className="promptTabs" role="tablist" aria-label="Example buyer question by scenario">
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

      <blockquote className="promptDemoQuote">
        <span className="promptDemoMark">&ldquo;</span>
        {active.buyerQuery}
      </blockquote>

      <p className="promptDemoFoot">
        Your page is what the AI cites — or doesn&apos;t.
      </p>
    </div>
  );
}

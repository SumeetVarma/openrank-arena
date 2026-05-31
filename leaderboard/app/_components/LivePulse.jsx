"use client";

// Tiny "live" indicator with a relative timestamp that ticks every minute.
// Used in the masthead to signal the page reflects fresh data.

import { useEffect, useState } from "react";

function rel(iso) {
  if (!iso) return "fresh";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function LivePulse({ lastEventAt }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  // referencing `now` keeps the relative string updating
  const label = lastEventAt ? `last update ${rel(lastEventAt)}` : "live";
  return (
    <span className="livePulse" title={lastEventAt ? new Date(lastEventAt).toLocaleString() : "live"} data-now={now}>
      <span className="livePulseDot" aria-hidden />
      <span className="livePulseLabel">{label}</span>
    </span>
  );
}

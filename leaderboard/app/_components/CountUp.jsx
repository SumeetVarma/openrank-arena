"use client";

import { useEffect, useRef, useState } from "react";

// Animates a number from 0 → target over `duration` ms when scrolled into view.
// Falls back to the static value if the user prefers reduced motion or IO isn't
// available. The target is preserved for SSR so the markup is stable.
export default function CountUp({ value, duration = 1200, suffix = "", format = (n) => n.toLocaleString() }) {
  const [display, setDisplay] = useState(value);
  const ref = useRef(null);
  const started = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) { setDisplay(value); return; }
    if (!ref.current || !("IntersectionObserver" in window)) { setDisplay(value); return; }

    const node = ref.current;
    setDisplay(0);
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !started.current) {
            started.current = true;
            const start = performance.now();
            const from = 0;
            const to = Number(value) || 0;
            const tick = (now) => {
              const t = Math.min(1, (now - start) / duration);
              // easeOutCubic
              const eased = 1 - Math.pow(1 - t, 3);
              const v = Math.round(from + (to - from) * eased);
              setDisplay(v);
              if (t < 1) requestAnimationFrame(tick);
              else setDisplay(to);
            };
            requestAnimationFrame(tick);
            io.disconnect();
          }
        }
      },
      { threshold: 0.4 }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [value, duration]);

  return (
    <span ref={ref} className="tnum">
      {format(display)}{suffix}
    </span>
  );
}

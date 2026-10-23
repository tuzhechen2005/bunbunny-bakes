"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useMotionPrefs } from "@/lib/motion/react";
import { planRoll, type RollPlan } from "./roll";

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/**
 * Price that rolls digit by digit when it changes (FRONTEND.md 4.1). Under reduced motion the new
 * value just appears. The plain value is always in the DOM as screen-reader text, so assistive
 * tech never reads half-animated digits.
 */
export function RollingText({ value, className = "" }: { value: string; className?: string }) {
  const { reduced } = useMotionPrefs();
  const [state, setState] = useState<{ value: string; plan: RollPlan | null; n: number }>({
    value,
    plan: null,
    n: 0,
  });
  if (state.value !== value) {
    setState({ value, plan: reduced ? null : planRoll(state.value, value), n: state.n + 1 });
  }
  const root = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el || !state.plan || typeof el.animate !== "function") return;
    const up = state.plan.up;
    el.querySelectorAll<HTMLElement>("[data-out]").forEach((out) => {
      out.animate([{ transform: "none" }, { transform: `translateY(${up ? -110 : 110}%)` }], {
        duration: 300,
        delay: Number(out.dataset.delay),
        easing: EASE,
        fill: "forwards",
      });
    });
    el.querySelectorAll<HTMLElement>("[data-in]").forEach((inn) => {
      inn.animate([{ transform: `translateY(${up ? 110 : -110}%)` }, { transform: "none" }], {
        duration: 300,
        delay: Number(inn.dataset.delay),
        easing: EASE,
        fill: "backwards",
      });
    });
    // The plan only ever changes together with `n`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.n]);

  const slots = state.plan
    ? state.plan.slots
    : [...state.value].map((ch) => ({ from: ch, to: ch, changed: false, delayMs: 0 }));

  return (
    <span ref={root} className={`inline-flex overflow-hidden align-bottom ${className}`}>
      <span className="sr-only">{state.value}</span>
      {slots.map((s, i) => (
        <span key={i} className="relative inline-block overflow-hidden" aria-hidden="true">
          <i className="block not-italic" data-in={s.changed ? "" : undefined} data-delay={s.delayMs}>
            {s.to}
          </i>
          {s.changed ? (
            <i className="absolute top-0 left-0 block not-italic" data-out="" data-delay={s.delayMs}>
              {s.from}
            </i>
          ) : null}
        </span>
      ))}
    </span>
  );
}

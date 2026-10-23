"use client";

import { useEffect, useRef } from "react";
import { useMotionPrefs } from "@/lib/motion/react";

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const DURATION_MS = 300;
const STAGGER_MS = 30;

/** Digits that roll like an odometer when the text changes (prototype `roll`). Display only. */
export function RollNumber({
  value,
  className,
  testId,
}: {
  value: string;
  className?: string;
  testId?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef<string | null>(null);
  const { reduced } = useMotionPrefs();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const old = prev.current;
    prev.current = value;
    el.textContent = "";
    const slot = (text: string) => {
      const s = document.createElement("span");
      s.style.cssText = "position:relative;display:inline-block;overflow:hidden";
      const i = document.createElement("i");
      i.style.cssText = "display:block;font-style:normal";
      i.textContent = text;
      s.appendChild(i);
      el.appendChild(s);
      return { s, i };
    };
    const animate = !reduced && old !== null && old !== value && typeof el.animate === "function";
    if (!animate) {
      for (const ch of value) slot(ch);
      return;
    }
    const num = (s: string) => parseFloat(s.replace(/[^\d.]/g, "")) || 0;
    const up = num(value) >= num(old);
    const n = Math.max(old.length, value.length);
    const o = old.padStart(n, " ");
    const v = value.padStart(n, " ");
    for (let j = 0; j < n; j++) {
      const a = o[j];
      const b = v[j];
      if (a === " " && b === " ") continue;
      const { s, i } = slot(b === " " ? "" : b);
      if (a === b) continue;
      const out = document.createElement("i");
      out.setAttribute("aria-hidden", "true");
      out.style.cssText = "display:block;font-style:normal;position:absolute;left:0;top:0";
      out.textContent = a === " " ? "" : a;
      s.appendChild(out);
      const delay = (n - 1 - j) * STAGGER_MS;
      const outAnim = out.animate(
        [{ transform: "none" }, { transform: `translateY(${up ? -110 : 110}%)` }],
        { duration: DURATION_MS, delay, easing: EASE, fill: "forwards" },
      );
      outAnim.onfinish = () => out.remove();
      outAnim.oncancel = () => out.remove();
      i.animate(
        [{ transform: `translateY(${up ? 110 : -110}%)` }, { transform: "none" }],
        { duration: DURATION_MS, delay, easing: EASE, fill: "backwards" },
      );
    }
  }, [value, reduced]);

  return (
    <span
      ref={ref}
      className={`inline-flex overflow-hidden align-bottom ${className ?? ""}`}
      data-testid={testId}
    />
  );
}

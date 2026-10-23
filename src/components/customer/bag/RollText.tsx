"use client";

import { useEffect, useState } from "react";
import { useMotionPrefs } from "@/lib/motion/react";
import "./bag.css";

interface Roll {
  seq: number;
  from: string;
  to: string;
  up: boolean;
}

const SLOT_MS = 300;
const STAGGER_MS = 30;

function numeric(s: string): number {
  return parseFloat(s.replace(/[^\d.]/g, "")) || 0;
}

/**
 * A short text (an amount, a count) whose characters roll like an odometer when it changes:
 * the old character leaves up (value went up) or down, the new one comes from the other side,
 * the last digit first. Reduced motion: the text changes in place. At rest the DOM holds exactly
 * the current text (the leaving characters are removed after the animation).
 */
export function RollText({ value, className, testId }: { value: string; className?: string; testId?: string }) {
  const { reduced } = useMotionPrefs();
  const [shown, setShown] = useState(value);
  const [roll, setRoll] = useState<Roll | null>(null);

  // Derive the animation while rendering so the new text never paints without it.
  if (value !== shown) {
    setShown(value);
    setRoll(reduced ? null : { seq: (roll?.seq ?? 0) + 1, from: shown, to: value, up: numeric(value) >= numeric(shown) });
  }

  const seq = roll?.seq;
  useEffect(() => {
    if (seq === undefined) return;
    const n = Math.max(shown.length, value.length);
    const timer = setTimeout(() => setRoll(null), SLOT_MS + n * STAGGER_MS + 60);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only when a new roll starts
  }, [seq]);

  if (!roll || roll.to !== value) {
    return (
      <span className={`rl ${className ?? ""}`} data-testid={testId} role="img" aria-label={value}>
        {Array.from(value).map((ch, i) => (
          <span className="rl-s" key={i}>
            <i>{ch}</i>
          </span>
        ))}
      </span>
    );
  }

  const n = Math.max(roll.from.length, roll.to.length);
  const from = roll.from.padStart(n, " ");
  const to = roll.to.padStart(n, " ");
  const slots = [];
  for (let j = 0; j < n; j++) {
    const a = from[j];
    const b = to[j];
    if (a === " " && b === " ") continue;
    const changed = a !== b;
    slots.push(
      <span className="rl-s" key={`${roll.seq}-${j}`} style={{ "--d": `${(n - 1 - j) * STAGGER_MS}ms` } as React.CSSProperties}>
        <i className={changed ? "nw" : undefined}>{b === " " ? "" : b}</i>
        {changed ? (
          // The leaving character is drawn from an attribute so the DOM text is always the current value.
          <i className="o" aria-hidden="true" data-ch={a === " " ? "" : a} />
        ) : null}
      </span>,
    );
  }
  return (
    <span
      className={`rl ${roll.up ? "rl-up" : "rl-down"} ${className ?? ""}`}
      data-testid={testId}
      role="img"
      aria-label={value}
    >
      {slots}
    </span>
  );
}

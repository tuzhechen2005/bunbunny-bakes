"use client";

/*
 * Adapted from React Bits "CountUp" (https://reactbits.dev) by David Haz.
 * MIT + Commons Clause License Condition v1.0 - see ./LICENSE.md. Not for redistribution as a component.
 * Changes: TypeScript, rolls from the currently shown number to the new `value` whenever it changes,
 * caller-supplied formatter (e.g. formatCents), no animation under prefers-reduced-motion.
 */
import { animate } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useMotionPrefs } from "@/lib/motion/react";

export interface CountUpProps {
  value: number;
  /** Turns the (rounded) number into text, e.g. cents -> "$8.99". Default: String. */
  format?: (n: number) => string;
  /** Seconds. */
  duration?: number;
  className?: string;
  "data-testid"?: string;
}

export function CountUp({ value, format = String, duration = 0.5, className, ...rest }: CountUpProps) {
  const { reduced } = useMotionPrefs();
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);

  useEffect(() => {
    if (reduced || shownRef.current === value) {
      shownRef.current = value;
      setShown(value);
      return;
    }
    const controls = animate(shownRef.current, value, {
      duration,
      ease: "easeOut",
      onUpdate: (v) => {
        const n = Math.round(v);
        shownRef.current = n;
        setShown(n);
      },
      onComplete: () => {
        shownRef.current = value;
        setShown(value);
      },
    });
    return () => controls.stop();
  }, [value, reduced, duration]);

  return (
    <span className={className} data-testid={rest["data-testid"]}>
      {format(reduced ? value : shown)}
    </span>
  );
}

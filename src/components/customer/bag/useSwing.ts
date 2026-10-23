"use client";

import { useCallback, useEffect, useRef } from "react";
import { createLoop, Spring, type Loop } from "@/lib/motion";
import { useMotionPrefs } from "@/lib/motion/react";

/** The bag swings from its bottom edge like a pendulum: 1.6 Hz, lightly damped (FRONTEND.md 4.3). */
const SWING = { frequencyHz: 1.6, dampingRatio: 0.32 };

/**
 * Swing wrapper for a bag. Put `ref` on an element with `transform-origin: 50% 100%` around the
 * PaperBag and call `kick(velocity)` (deg/s, e.g. 46 for a landing). Stops the frame loop when
 * the bag rests; does nothing under reduced motion.
 */
export function useSwing() {
  const ref = useRef<HTMLDivElement>(null);
  // Reduced: no swing. Degraded (low fps): the pendulum goes too, the squash and bread stay.
  const { reduced, degraded } = useMotionPrefs();
  const reducedRef = useRef(reduced || degraded);
  const spring = useRef<Spring | null>(null);
  const loop = useRef<Loop | null>(null);

  useEffect(() => {
    reducedRef.current = reduced || degraded;
  }, [reduced, degraded]);

  useEffect(() => {
    const s = new Spring(0, SWING);
    spring.current = s;
    const l = createLoop((dt) => {
      s.step(dt);
      const el = ref.current;
      if (Math.abs(s.x) < 0.02 && Math.abs(s.v) < 0.05) {
        s.set(0, 0);
        if (el) el.style.transform = "";
        return false;
      }
      if (el) el.style.transform = `rotate(${s.x.toFixed(2)}deg)`;
      return true;
    });
    loop.current = l;
    return () => {
      l.stop();
      loop.current = null;
      spring.current = null;
    };
  }, []);

  const kick = useCallback((velocity: number) => {
    if (reducedRef.current || !spring.current) return;
    spring.current.v += velocity;
    loop.current?.start();
  }, []);

  return { ref, kick };
}

"use client";

import { useEffect, useRef } from "react";
import { useMotionPrefs } from "@/lib/motion/react";

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/**
 * Error line under a checkout block. Every time `seq` changes (a new error was raised, even with
 * the same text) it shakes a little and scrolls into view. Reduced motion: no shake, no smooth scroll.
 */
export function FieldError({
  id,
  message,
  seq,
  scroll = true,
  testId,
  children,
}: {
  id?: string;
  message: string;
  seq: number;
  scroll?: boolean;
  testId?: string;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { reduced } = useMotionPrefs();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!reduced && typeof el.animate === "function") {
      el.animate(
        [
          { transform: "translateX(0)" },
          { transform: "translateX(-6px)" },
          { transform: "translateX(5px)" },
          { transform: "translateX(-2px)" },
          { transform: "none" },
        ],
        { duration: 320, easing: EASE },
      );
    }
    if (scroll && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    }
    // Only a new error (seq) triggers this; motion prefs are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);

  return (
    <div
      ref={ref}
      id={id}
      role="alert"
      className="mt-2.5 text-[13.5px] leading-snug font-semibold text-c-red"
      data-testid={testId}
    >
      <p>{message}</p>
      {children}
    </div>
  );
}

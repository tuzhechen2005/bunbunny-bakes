"use client";

/*
 * Adapted from React Bits "BlurText" (https://reactbits.dev) by David Haz.
 * MIT + Commons Clause License Condition v1.0 - see ./LICENSE.md. Not for redistribution as a component.
 * Changes: TypeScript, per-character reveal (CJK has no spaces), LazyMotion `m`, plays once on mount,
 * final state rendered straight away under prefers-reduced-motion.
 */
import { m } from "motion/react";
import { useMotionPrefs } from "@/lib/motion/react";
import { MotionProvider } from "./MotionProvider";

export interface BlurTextProps {
  text: string;
  className?: string;
  /** Delay between characters in ms. */
  delay?: number;
  /** Start blur in px. */
  blur?: number;
  onAnimationComplete?: () => void;
}

export function BlurText({ text, className, delay = 70, blur = 10, onAnimationComplete }: BlurTextProps) {
  const { reduced } = useMotionPrefs();
  if (reduced) return <span className={className}>{text}</span>;

  const chars = Array.from(text);
  return (
    <MotionProvider>
      <BlurChars chars={chars} text={text} className={className} delay={delay} blur={blur} onAnimationComplete={onAnimationComplete} />
    </MotionProvider>
  );
}

function BlurChars({
  chars,
  text,
  className,
  delay,
  blur,
  onAnimationComplete,
}: { chars: string[]; text: string } & Required<Pick<BlurTextProps, "delay" | "blur">> &
  Pick<BlurTextProps, "className" | "onAnimationComplete">) {
  return (
    <span className={className} aria-label={text} style={{ display: "inline-block" }}>
      {chars.map((ch, i) => (
        <m.span
          key={i}
          aria-hidden="true"
          style={{ display: "inline-block", whiteSpace: "pre", willChange: "filter, opacity, transform" }}
          initial={{ filter: `blur(${blur}px)`, opacity: 0, y: -8 }}
          animate={{
            filter: [`blur(${blur}px)`, `blur(${blur / 2}px)`, "blur(0px)"],
            opacity: [0, 0.5, 1],
            y: [-8, 3, 0],
          }}
          transition={{ duration: 0.6, times: [0, 0.5, 1], delay: (i * delay) / 1000, ease: "easeOut" }}
          onAnimationComplete={i === chars.length - 1 ? onAnimationComplete : undefined}
        >
          {ch}
        </m.span>
      ))}
    </span>
  );
}

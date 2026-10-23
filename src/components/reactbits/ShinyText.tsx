"use client";

/*
 * Adapted from React Bits "ShinyText" (https://reactbits.dev) by David Haz.
 * MIT + Commons Clause License Condition v1.0 - see ./LICENSE.md. Not for redistribution as a component.
 * Changes: TypeScript, pure CSS keyframes (.shiny-text in globals.css, no JS per frame),
 * colours from our tokens, a sweep every `intervalSeconds`, static text under reduced motion / low fps.
 */
import type { CSSProperties } from "react";
import { useMotionPrefs } from "@/lib/motion/react";

export interface ShinyTextProps {
  text: string;
  className?: string;
  /** Seconds between sweeps (the sweep itself takes ~1.2 s). Default 5. */
  intervalSeconds?: number;
  /** CSS colour for the text. Default: caramel token. */
  color?: string;
  /** CSS colour of the highlight. Default: caramel-tint token. */
  shineColor?: string;
}

export function ShinyText({
  text,
  className,
  intervalSeconds = 5,
  color = "var(--caramel)",
  shineColor = "var(--caramel-tint)",
}: ShinyTextProps) {
  const { reduced, degraded } = useMotionPrefs();
  if (reduced || degraded) {
    return (
      <span className={className} style={{ color }}>
        {text}
      </span>
    );
  }
  const style = {
    "--shiny-base": color,
    "--shiny-hi": shineColor,
    "--shiny-cycle": `${intervalSeconds + 1.2}s`,
  } as CSSProperties;
  return (
    <span className={`shiny-text ${className ?? ""}`} style={style}>
      {text}
    </span>
  );
}

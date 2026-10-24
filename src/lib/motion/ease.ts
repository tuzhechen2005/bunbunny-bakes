// The one easing family and the duration scale of the customer side (audit Top 10).
// Mirrors the CSS tokens in src/app/globals.css (--ease, --ease-in, --ease-inout, --dur-1..4); use
// these constants from TS (Web Animations, motion/react, inline styles) and the tokens from CSS.

/** Things entering or moving: fast start, long soft landing. */
export const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
/** Things leaving: slow start, fast exit. */
export const EASE_IN = "cubic-bezier(0.5, 0, 0.75, 0)";
/** Symmetric moves (a thing going there and back). */
export const EASE_INOUT = "cubic-bezier(0.65, 0, 0.35, 1)";

/** The same curves as control points, for motion/react (`transition: { ease: EASE_BEZIER }`). */
export const EASE_BEZIER = [0.2, 0.8, 0.2, 1] as const;
export const EASE_IN_BEZIER = [0.5, 0, 0.75, 0] as const;
export const EASE_INOUT_BEZIER = [0.65, 0, 0.35, 1] as const;

/** Duration scale in ms (--dur-1..4): taps, default move, large surfaces, signature moments. */
export const DUR = { 1: 160, 2: 280, 3: 420, 4: 640 } as const;
/** Same values in seconds, for motion/react. */
export const DUR_S = { 1: 0.16, 2: 0.28, 3: 0.42, 4: 0.64 } as const;

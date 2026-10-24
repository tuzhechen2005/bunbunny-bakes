/** Small Web Animations helpers shared by the bag components. Never throw, never block. */

export const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
/** Exit curve: things leave slowly at first, then fast. */
export const EASE_IN = "cubic-bezier(0.5, 0, 0.75, 0)";

/**
 * element.animate with the reduced-motion rule built in: when `reduced`, only the opacity part of
 * the keyframes plays (at most 200 ms), everything else is skipped. Returns null when nothing runs.
 */
export function play(
  el: Element | null | undefined,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
  reduced: boolean,
): Animation | null {
  if (!el || typeof el.animate !== "function") return null;
  try {
    if (!reduced) return el.animate(keyframes, options);
    const fades = keyframes.filter((k) => k.opacity != null).map((k) => ({ opacity: k.opacity }));
    if (fades.length < 2) return null;
    return el.animate(fades, {
      duration: Math.min(Number(options.duration ?? 200), 200),
      fill: options.fill ?? "none",
    });
  } catch {
    return null;
  }
}

/** Resolves when the animation finished or was cancelled; resolves at once for null. */
export function done(a: Animation | null): Promise<void> {
  return a ? a.finished.then(
    () => undefined,
    () => undefined,
  ) : Promise.resolve();
}

/**
 * The arrow "zoom" of the bag button and 去结算 (FRONTEND.md 4.1 item 7): the arrow accelerates
 * out to the right, then slides back in from the left (about 0.3 s). Resolves when it is done.
 * No arrow, reduced motion or no Web Animations: resolves at once.
 */
export function arrowZoom(root: Element | null | undefined, reduced: boolean): Promise<void> {
  const svg = root?.querySelector("[data-zoom-arrow]");
  if (!svg || reduced || typeof svg.animate !== "function") return Promise.resolve();
  try {
    const out = svg.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-5px)", offset: 0.18 },
        { transform: "translateX(170%)" },
      ],
      { duration: 300, easing: "cubic-bezier(0.6, 0, 1, 0.5)" },
    );
    return out.finished.then(
      () => {
        svg.animate([{ transform: "translateX(-170%)" }, { transform: "none" }], { duration: 260, easing: EASE });
        return new Promise<void>((resolve) => setTimeout(resolve, 40));
      },
      () => undefined,
    );
  } catch {
    return Promise.resolve();
  }
}

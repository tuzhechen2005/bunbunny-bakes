"use client";

import { useEffect, useRef, useState } from "react";
import { useMotionPrefs } from "@/lib/motion/react";

/** Enter / move easing and the exit easing (one family, see src/lib/motion/README.md). */
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const EASE_IN = "cubic-bezier(0.5, 0, 0.75, 0)";

/** The old name leaves quickly and slightly; the new one waits a beat so the two never ghost. */
const OUT_MS = 150;
const OUT_PX = 14;
const IN_MS = 360;
const IN_DELAY_MS = 90;
const IN_PX = 22;

interface Item {
  id: number;
  text: string;
  leaving: boolean;
  /** Played once on mount; false for the very first name. */
  enter: boolean;
}

/**
 * The current bread's name: when it changes the old one slides out and the new one slides in
 * from the side the rope moved to (dir 1 = next). Reduced motion: plain fade.
 * At most one name is leaving at a time: a name that is still on its way out is dropped when the
 * next swap starts, and one that is still arriving turns around from where it is.
 */
export function NameSwap({ text, dir }: { text: string; dir: 1 | -1 }) {
  const [items, setItems] = useState<Item[]>([{ id: 0, text, leaving: false, enter: false }]);
  const seq = useRef(0);
  const last = useRef(text);

  useEffect(() => {
    if (last.current === text) return;
    last.current = text;
    const id = ++seq.current;
    setItems((cur) => [
      ...cur.filter((i) => !i.leaving).map((i) => ({ ...i, leaving: true })),
      { id, text, leaving: false, enter: true },
    ]);
    const timer = setTimeout(() => setItems((cur) => cur.filter((i) => !i.leaving)), OUT_MS + 60);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <>
      {items.map((it) => (
        <NameItem key={it.id} item={it} dir={dir} />
      ))}
    </>
  );
}

function NameItem({ item, dir }: { item: Item; dir: 1 | -1 }) {
  const { reduced } = useMotionPrefs();
  const el = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!item.enter || !el.current?.animate) return;
    el.current.animate(
      reduced
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { transform: `translateX(${IN_PX * dir}px)`, opacity: 0 },
            { transform: "none", opacity: 1 },
          ],
      { duration: reduced ? 200 : IN_MS, delay: reduced ? OUT_MS : IN_DELAY_MS, easing: EASE, fill: "backwards" },
    );
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const node = el.current;
    if (!item.leaving || !node?.animate) return;
    // Leave from wherever the name is now (it may still be arriving).
    const cs = getComputedStyle(node);
    const from = { opacity: cs.opacity, transform: cs.transform === "none" ? "none" : cs.transform };
    node.getAnimations().forEach((a) => a.cancel());
    node.animate(
      reduced
        ? [from, { opacity: 0 }]
        : [from, { transform: `translateX(${-OUT_PX * dir}px)`, opacity: 0 }],
      { duration: reduced ? 120 : OUT_MS, easing: reduced ? "linear" : EASE_IN, fill: "forwards" },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.leaving]);

  return (
    <span ref={el} aria-hidden={item.leaving ? "true" : undefined}>
      {item.text}
    </span>
  );
}

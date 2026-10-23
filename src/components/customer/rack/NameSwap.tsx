"use client";

import { useEffect, useRef, useState } from "react";
import { useMotionPrefs } from "@/lib/motion/react";

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

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
 */
export function NameSwap({ text, dir }: { text: string; dir: 1 | -1 }) {
  const [items, setItems] = useState<Item[]>([{ id: 0, text, leaving: false, enter: false }]);
  const seq = useRef(0);
  const last = useRef(text);

  useEffect(() => {
    if (last.current === text) return;
    last.current = text;
    const id = ++seq.current;
    setItems((cur) => [...cur.map((i) => ({ ...i, leaving: true })), { id, text, leaving: false, enter: true }]);
    const timer = setTimeout(() => setItems((cur) => cur.filter((i) => !i.leaving)), 280);
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
            { transform: `translateX(${30 * dir}px)`, opacity: 0 },
            { transform: "none", opacity: 1 },
          ],
      { duration: reduced ? 200 : 420, easing: EASE, fill: "backwards" },
    );
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!item.leaving || !el.current?.animate) return;
    el.current.animate(
      reduced
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [
            { transform: "none", opacity: 1 },
            { transform: `translateX(${-24 * dir}px)`, opacity: 0 },
          ],
      { duration: reduced ? 150 : 260, easing: EASE, fill: "forwards" },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.leaving]);

  return (
    <span ref={el} aria-hidden={item.leaving ? "true" : undefined}>
      {item.text}
    </span>
  );
}

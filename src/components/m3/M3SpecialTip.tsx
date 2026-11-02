import { useEffect, useRef, useState } from "react";
import { copy } from "@/copy";
import { BIG_BASE, ROLL_BASE, m3LevelRules } from "@/lib/m3";

type Kind = "roll" | "big";
const storageKey = (kind: Kind) => `bb_m3_special_tip_${kind}`;

/** Observe the displayed board, including transient specials during a cascade. */
export function M3SpecialTip({ board }: { board: readonly (readonly number[])[] }) {
  const hasRoll = board.some(row => row.some(code => code >= ROLL_BASE && code < BIG_BASE));
  const hasBig = board.some(row => row.some(code => code >= BIG_BASE));
  const seen = useRef(new Set<Kind>());
  const [queue, setQueue] = useState<Kind[]>([]);
  const active = queue[0];

  useEffect(() => {
    const id = setTimeout(() => {
      const added: Kind[] = [];
      for (const kind of ["roll", "big"] as const) {
        if (!(kind === "roll" ? hasRoll : hasBig) || seen.current.has(kind)) continue;
        seen.current.add(kind);
        try {
          if (window.localStorage.getItem(storageKey(kind))) continue;
        } catch { /* Keep the tutorial usable when browser storage is unavailable. */ }
        added.push(kind);
      }
      if (added.length) setQueue(pending => [...pending, ...added]);
    }, 0);
    return () => clearTimeout(id);
  }, [hasRoll, hasBig]);

  useEffect(() => {
    if (!active) return;
    // Only persist a tip once it is shown, not while it is waiting in the queue.
    try { window.localStorage.setItem(storageKey(active), "1"); }
    catch { /* The in-memory set still prevents repeats on this board. */ }
    // Hold for two seconds, then allow the 200ms CSS fade to finish.
    const id = setTimeout(() => setQueue(pending => pending.slice(1)), 2200);
    return () => clearTimeout(id);
  }, [active]);

  return <div className="m3-special-tip-region" role="status" aria-live="polite" aria-atomic="true">
    {active && <p key={active} className="m3-special-tip" data-testid="m3-special-tip">
      {copy.customer.m3.specialHelp[active].tip}
    </p>}
  </div>;
}

const kindKey = (tierCount: number) => `bb_m3_new_kind_${tierCount}`;
/** D184: the first level that adds a bread kind (7, 19) says so once, until the first move. */
export function M3KindHint({ level, tierCount, started }: { level: number; tierCount: number; started: boolean }) {
  const adds = level > 1 && tierCount > m3LevelRules(level - 1).tierCount;
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!adds || started) return;
    const id = setTimeout(() => {
      try {
        if (window.localStorage.getItem(kindKey(tierCount))) return;
        window.localStorage.setItem(kindKey(tierCount), "1");
      } catch { /* Without storage the line shows each time this level starts. */ }
      setShown(true);
    }, 0);
    return () => clearTimeout(id);
  }, [adds, started, tierCount]);
  // In flow (the line keeps its height after the first move), so it never covers the orders or the board.
  if (!shown) return null;
  return <p className="m3-kind-hint" role="status" data-testid="m3-kind-hint" data-hidden={started || undefined}>{copy.customer.m3.newKindHint}</p>;
}

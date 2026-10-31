import { useEffect, useRef, useState } from "react";
import { copy } from "@/copy";
import { BIG_BASE, ROLL_BASE } from "@/lib/m3";

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

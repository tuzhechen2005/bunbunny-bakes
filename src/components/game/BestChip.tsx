"use client";

import { fill } from "@/components/customer/format";
import { copy } from "@/copy";
import { PieceChip } from "./PieceChip";
import type { TierView } from "./types";

const t = copy.customer.game;
const BOX = 40;

/** Pieces are drawn in proportion to their real size, so growing up the ladder is visible. */
const diameter = (tiers: TierView[], i: number) => {
  const max = Math.max(...tiers.map((x) => x.radius));
  return Math.round(BOX * (0.45 + 0.55 * (tiers[i].radius / max)));
};

/**
 * D184: the best bread reached this run, and the next one up as a dark silhouette. It sits in the HUD
 * row, never over the board. `pop` changes each time a new tier is reached: the best chip pops once.
 */
export function BestChip({ tiers, best, upcoming, pop }: { tiers: TierView[]; best: number | null; upcoming: number | null; pop: number }) {
  const label = best === null
    ? t.bestNone
    : fill(upcoming === null ? t.bestTop : t.bestNext, { best: tiers[best]?.name ?? "", next: upcoming === null ? "" : (tiers[upcoming]?.name ?? "") });
  return (
    <div className="game-best flex items-center gap-1" role="img" aria-label={label} data-testid="game-best-chip" data-best={best ?? ""} data-next={upcoming ?? ""}>
      <span className="grid place-items-center" style={{ width: BOX, height: BOX }}>
        {best === null ? (
          <span className="block rounded-full border border-dashed border-c-grey" style={{ width: 28, height: 28 }} aria-hidden="true" />
        ) : (
          <span key={pop} className={pop ? "game-best-pop block" : "block"} data-testid="game-best-piece">
            <PieceChip tier={tiers[best]} size={diameter(tiers, best)} />
          </span>
        )}
      </span>
      {upcoming !== null ? (
        <>
          <svg viewBox="0 0 8 12" className="h-3 w-2 shrink-0 text-c-grey" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1.5 1.5L6 6l-4.5 4.5" />
          </svg>
          <span className="grid place-items-center" style={{ width: BOX, height: BOX }} data-testid="game-best-next">
            <PieceChip tier={tiers[upcoming]} size={diameter(tiers, upcoming)} dark />
          </span>
        </>
      ) : null}
    </div>
  );
}

import type { TuProp, TuState } from "./engine";

/** Public-information-only planning hints; never reveal hidden tile identities. */
export function tuPlanning(state: TuState) {
  const slotsLeft = state.bagSize - state.bag.length;
  const pairs = [...new Set(state.bag)].filter(tier => state.bag.filter(t => t === tier).length === 2);
  const usable = (p: TuProp) => !state.over && state.props[p] > 0 && (p !== "bag" || state.bagSize === 6);
  return {
    slotsLeft,
    pairTiers: slotsLeft <= 2 ? pairs : [],
    props: {
      peek: { usable: usable("peek"), hiddenTileCount: state.tiles.filter(t => !t.visible).length },
      bag: { usable: usable("bag"), slotsAdded: state.bagSize === 6 ? 1 : 0 },
      swap: { usable: usable("swap"), orderIndexes: [0, 1] as const },
    },
  };
}

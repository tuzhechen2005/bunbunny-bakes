import type { GrabItem, GrabState } from "@/lib/grab";

export function isGrabRefilling(item: GrabItem, tick: number): boolean {
  return tick > item.age && item.age < 18;
}

/** Only React-visible changes; per-frame claw transforms are painted through refs. */
export function grabPresentationKey(state: GrabState): string {
  return [Math.ceil(state.timeLeft / 60), state.score, state.over, state.claw.phase,
    state.claw.held?.id ?? 0,
    ...state.items.map(item => `${item.id}:${item.stage}:${isGrabRefilling(item, state.tick)}`),
  ].join("|");
}

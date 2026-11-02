import type { GrabItem, GrabState } from "@/lib/grab";

export function isGrabRefilling(item: GrabItem, tick: number): boolean {
  return tick > item.age && item.age < 18;
}

/**
 * Only React-visible changes; per-frame claw transforms and item positions are painted through refs.
 * Includes the level/order/chain HUD fields, the contact label and each item's facing.
 */
export function grabPresentationKey(state: GrabState): string {
  return [Math.ceil(state.timeLeft / 60), state.score, state.over, state.claw.phase,
    state.claw.held?.id ?? 0,
    state.level, state.levelTarget, state.completedOrders, state.perfectChain, state.nextPerfectBonusPercent,
    state.order.id, state.order.remaining.join(""), state.pendingResult?.item ?? 0,
    ...state.items.map(item => `${item.id}:${item.stage}:${isGrabRefilling(item, state.tick)}:${Math.sign(item.velocityX ?? 0)}`),
  ].join("|");
}

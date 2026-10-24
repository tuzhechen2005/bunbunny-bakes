// Status wording and the forward-step choices for the admin order screens. Pure.

import { copy } from "@/copy";
import { FORWARD_CHAIN } from "@/domain/status";
import type { Fulfillment, OrderStatus } from "@/domain/types";

const t = copy.admin.orders;

/** 「可取货」, but 「配送中」 on a delivery order (same word the customer sees). */
export function statusLabel(status: OrderStatus, fulfillment?: Fulfillment): string {
  if (status === "READY" && fulfillment === "DELIVERY") return t.readyDelivery;
  return t.statusLabels[status];
}

/** Button label for moving an order to `to`; "标为配送中" for delivery orders. */
export function moveToLabel(to: OrderStatus, fulfillment?: Fulfillment): string {
  if (to === "READY" && fulfillment === "DELIVERY") return t.moveToReadyDelivery;
  return t.moveTo[to as keyof typeof t.moveTo] ?? statusLabel(to, fulfillment);
}

export interface ForwardChoices {
  /** The very next step on the chain: the one prominent button. */
  next: OrderStatus | null;
  /** Later steps the server also allows; each one skips at least one step. */
  jumps: OrderStatus[];
}

/** Splits the allowed no-reason moves into the next step and the jumps beyond it. */
export function forwardChoices(from: OrderStatus, allowed: readonly OrderStatus[]): ForwardChoices {
  const at = FORWARD_CHAIN.indexOf(from);
  const forward = allowed
    .filter((s) => FORWARD_CHAIN.indexOf(s) > at)
    .sort((a, b) => FORWARD_CHAIN.indexOf(a) - FORWARD_CHAIN.indexOf(b));
  return { next: forward[0] ?? null, jumps: forward.slice(1) };
}

/** The steps passed over when moving `from` to `to` (exclusive of both). */
export function skippedSteps(from: OrderStatus, to: OrderStatus): OrderStatus[] {
  return FORWARD_CHAIN.slice(FORWARD_CHAIN.indexOf(from) + 1, FORWARD_CHAIN.indexOf(to));
}

// Order status machine (DATA_MODEL.md §2, CAPACITY_RULES.md §9, D46).
// Pure: no Prisma, no runtime clock.

import { copy } from "@/copy";
import type { Fulfillment, OrderStatus } from "./types";
import { OCCUPYING_STATUSES } from "./types";

/** Forward order of the normal flow; admins may move forward, skipping steps. */
export const FORWARD_CHAIN: readonly OrderStatus[] = [
  "NEW",
  "CONTACTED",
  "CONFIRMED",
  "BAKING",
  "READY",
  "COMPLETED",
];

const TERMINAL: readonly OrderStatus[] = ["COMPLETED", "CANCELLED", "REJECTED"];
const REJECTABLE_FROM: readonly OrderStatus[] = ["NEW", "CONTACTED"];
const CUSTOMER_CANCELLABLE: readonly OrderStatus[] = ["NEW", "CONTACTED", "CONFIRMED"];

export function isOccupying(s: OrderStatus): boolean {
  return OCCUPYING_STATUSES.includes(s);
}

export function isTerminal(s: OrderStatus): boolean {
  return TERMINAL.includes(s);
}

export type TransitionCheck = { ok: true; reasonRequired: boolean } | { ok: false };

const NOT_OK: TransitionCheck = { ok: false };

/** Normal admin status change: forward only (skips allowed), or cancel/reject with a reason. */
export function adminTransition(from: OrderStatus, to: OrderStatus): TransitionCheck {
  if (from === to || isTerminal(from)) return NOT_OK;
  if (to === "CANCELLED") return { ok: true, reasonRequired: true };
  if (to === "REJECTED") {
    return REJECTABLE_FROM.includes(from) ? { ok: true, reasonRequired: true } : NOT_OK;
  }
  // Both are on the forward chain here (from is non-terminal, to is not CANCELLED/REJECTED).
  return FORWARD_CHAIN.indexOf(to) > FORWARD_CHAIN.indexOf(from)
    ? { ok: true, reasonRequired: false }
    : NOT_OK;
}

/** Owner's "更正状态": any change, always with a reason (D46). */
export function correctStatus(from: OrderStatus, to: OrderStatus): TransitionCheck {
  return from === to ? NOT_OK : { ok: true, reasonRequired: true };
}

/** True when a correction moves a non-occupying order back into an occupying status. */
export function correctionReoccupies(from: OrderStatus, to: OrderStatus): boolean {
  return !isOccupying(from) && isOccupying(to);
}

/** Position on the forward chain, or -1 for CANCELLED/REJECTED. */
function chainIndex(s: OrderStatus): number {
  return FORWARD_CHAIN.indexOf(s);
}

const CONFIRMED_INDEX = chainIndex("CONFIRMED");

/** True when the change crosses into CONFIRMED-or-later from before CONFIRMED (set confirmedAt). */
export function entersConfirmed(from: OrderStatus, to: OrderStatus): boolean {
  const f = chainIndex(from);
  const t = chainIndex(to);
  return f >= 0 && f < CONFIRMED_INDEX && t >= CONFIRMED_INDEX;
}

/** CAPACITY_RULES.md §9: status ∈ {NEW, CONTACTED, CONFIRMED} and now < cutoffAt. */
export function customerCanCancel(status: OrderStatus, now: Date, cutoffAt: Date): boolean {
  return CUSTOMER_CANCELLABLE.includes(status) && now.getTime() < cutoffAt.getTime();
}

export interface CustomerStatusInput {
  status: OrderStatus;
  fulfillment: Fulfillment;
  hasDoughItem: boolean;
  ownerWechatId: string;
  bakingTextBread: string;
  bakingTextOther: string;
}

/** Merged status text shown to customers (DATA_MODEL.md §2 table). */
export function customerStatusText(input: CustomerStatusInput): string {
  const t = copy.customerStatus;
  switch (input.status) {
    case "NEW":
    case "CONTACTED":
      return t.pending.replace("{ownerWechatId}", () => input.ownerWechatId);
    case "CONFIRMED":
      return t.confirmed;
    case "BAKING":
      return input.hasDoughItem ? input.bakingTextBread : input.bakingTextOther;
    case "READY":
      return input.fulfillment === "DELIVERY" ? t.readyDelivery : t.readyPickup;
    case "COMPLETED":
      return t.completed;
    case "CANCELLED":
    case "REJECTED":
      return t.cancelled;
  }
}

"use client";

/**
 * Bookkeeping between <FlyLayer/> (draws the flights) and the bags (receive the bread).
 *
 * The cart is updated at click time, but a bread only drops into the bag when its flight lands.
 * So the bags show the cart minus the bodies still in the air (`pending`), and a landing puts
 * exactly those bodies into the pile at the spot where the disc came down. Nothing is ever
 * counted twice: pending goes down in the same tick that the bodies are added.
 */
import { useSyncExternalStore } from "react";

export type BagTarget = "bar" | "sheet";

export interface FlightBegin {
  productId: string;
  /** Total breads of this add (one request may fly as several discs). */
  count: number;
}

export interface Landing {
  productId: string;
  /** Bodies that arrive with this landing. */
  count: number;
  /** Where in the bag window the disc came down, 0 = left edge, 1 = right edge; null = anywhere. */
  xFrac: number | null;
  /** Which bag was hit (null: the flight was skipped or no bag window was visible). */
  target: BagTarget | null;
  /** The first disc of an add: this one swings and squashes the bag, the others just drop in. */
  first: boolean;
}

const EMPTY: ReadonlyMap<string, number> = new Map();
let pending: ReadonlyMap<string, number> = EMPTY;
const pendingListeners = new Set<() => void>();
const beginListeners = new Set<(b: FlightBegin) => void>();
const landListeners = new Set<(l: Landing) => void>();

function setPending(next: Map<string, number>): void {
  for (const [k, v] of next) if (v <= 0) next.delete(k);
  pending = next.size ? next : EMPTY;
  pendingListeners.forEach((cb) => cb());
}

/** FlyLayer: an add starts (call once per flyToBag request, before any disc leaves). */
export function flightBegin(b: FlightBegin): void {
  const next = new Map(pending);
  next.set(b.productId, (next.get(b.productId) ?? 0) + b.count);
  setPending(next);
  beginListeners.forEach((cb) => cb(b));
}

/** FlyLayer: a disc landed (or was skipped). Bags first drop the bodies, then pending shrinks. */
export function flightLand(l: Landing): void {
  landListeners.forEach((cb) => cb(l));
  const next = new Map(pending);
  next.set(l.productId, (next.get(l.productId) ?? 0) - l.count);
  setPending(next);
}

export function subscribeBegin(cb: (b: FlightBegin) => void): () => void {
  beginListeners.add(cb);
  return () => {
    beginListeners.delete(cb);
  };
}

export function subscribeLand(cb: (l: Landing) => void): () => void {
  landListeners.add(cb);
  return () => {
    landListeners.delete(cb);
  };
}

function subscribePending(cb: () => void): () => void {
  pendingListeners.add(cb);
  return () => {
    pendingListeners.delete(cb);
  };
}

/** Breads of the current flights that have not landed yet, per product. */
export function usePendingFlights(): ReadonlyMap<string, number> {
  return useSyncExternalStore(
    subscribePending,
    () => pending,
    () => EMPTY,
  );
}

/** Non-hook read of the same data (tests, event handlers). */
export function pendingFlights(): ReadonlyMap<string, number> {
  return pending;
}

/** Test helper: forget everything in flight. */
export function resetFlights(): void {
  setPending(new Map());
}

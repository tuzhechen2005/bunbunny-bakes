"use client";

/**
 * Fly-to-bag contract (FRONTEND.md 4.3). Producers (detail page, list rows) call `flyToBag`;
 * the bag (BagBar / the paper bag) registers itself as the landing target with `useBagTarget`; <FlyLayer/>
 * (src/components/customer/bag/FlyLayer.tsx) renders the flight in between.
 *
 * Timing contract: the flight takes about 0.6 s along an arc. It lives in a fixed,
 * `pointer-events: none` overlay, so it never blocks clicks; several flights may overlap
 * (rapid adds). The cart is updated by the caller immediately, not on arrival; `onArrive`
 * only drives decoration (the bag swinging).
 */
import { useEffect, useRef, type RefObject } from "react";

export interface FlyRequest {
  /** Where the thumbnail starts (e.g. getBoundingClientRect of the photo). */
  from: DOMRect;
  /** Small product image; null shows the bunny placeholder. */
  imageUrl: string | null;
  productId: string;
  /** How many items this add represents (detail page adds the chosen quantity). Default 1. */
  count?: number;
}

export const FLY_EVENT = "bunbunny:fly-to-bag";
/** Flight duration in ms. */
export const FLY_DURATION_MS = 600;

/** Start a flight. Fire and forget: never throws, never blocks, no-op during SSR. */
export function flyToBag(req: FlyRequest): void {
  try {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent<FlyRequest>(FLY_EVENT, { detail: req }));
  } catch {
    /* decoration only */
  }
}

/** Subscribe to flight requests (used by <FlyLayer/>). Returns the unsubscribe function. */
export function subscribeFly(cb: (req: FlyRequest) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<FlyRequest>).detail);
  window.addEventListener(FLY_EVENT, handler);
  return () => window.removeEventListener(FLY_EVENT, handler);
}

// ---- bag target registry (module scope: there is one bag on the page) ----

let targetEl: HTMLElement | null = null;
const arriveListeners = new Set<() => void>();

/** Where flights should land; null if no bag is mounted. */
export function getBagTargetRect(): DOMRect | null {
  return targetEl ? targetEl.getBoundingClientRect() : null;
}

/** Called by <FlyLayer/> when a flight lands (or is skipped under reduced motion). */
export function notifyArrive(): void {
  arriveListeners.forEach((cb) => cb());
}

/**
 * For the bag component: attach `ref` to the element flights should land on, and use
 * `onArrive(cb)` to react (swing the bag). `onArrive` returns an unsubscribe function.
 */
export function useBagTarget(): {
  ref: RefObject<HTMLElement | null>;
  onArrive: (cb: () => void) => () => void;
} {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    targetEl = el;
    return () => {
      if (targetEl === el) targetEl = null;
    };
  }, []);
  const onArrive = (cb: () => void) => {
    arriveListeners.add(cb);
    return () => {
      arriveListeners.delete(cb);
    };
  };
  return { ref, onArrive };
}

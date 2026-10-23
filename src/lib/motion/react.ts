"use client";

import { useSyncExternalStore } from "react";
import { motionHealth } from "./fps";

export interface MotionPrefs {
  /** prefers-reduced-motion: no swing, flight or 3D; fade only; text effects show their end state. */
  reduced: boolean;
  /** Sustained low fps: drop the pendulum and the side tilt, keep the translation. */
  degraded: boolean;
}

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduced(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}
const getReduced = () =>
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(QUERY).matches;
// Server render assumes full motion; the client corrects on hydration.
const getServer = () => false;

const subscribeDegraded = (cb: () => void) => motionHealth.subscribe(cb);
const getDegraded = () => motionHealth.degraded;

export function useMotionPrefs(): MotionPrefs {
  const reduced = useSyncExternalStore(subscribeReduced, getReduced, getServer);
  const degraded = useSyncExternalStore(subscribeDegraded, getDegraded, getServer);
  return { reduced, degraded };
}

/** Short vibration where supported (Android). Never throws; no-op on iPhone and desktop. */
export function haptic(ms = 15): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(ms);
    }
  } catch {
    /* ignore: haptics are optional */
  }
}

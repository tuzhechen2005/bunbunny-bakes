// The autosave of the 兔了个兔 run in progress (D124 = D111): this phone only; resume replays the taps.
import type { TierView } from "@/components/game/types";
import type { TuTapLog } from "./tuApi";

// v2: props and the harder curve (C8) changed the engine, so runs saved by the old engine are dropped.
export const TU_SAVE_KEY = "bb_tu_save_v2";
const OLD_SAVE_KEY = "bb_tu_save_v1";

export interface TuSave {
  v: 1;
  runId: string;
  seed: string;
  tiers: TierView[];
  taps: TuTapLog[];
  nickname: string;
  /** ISO instant: the weekly reset after which the run can no longer be finished. */
  expiresAt: string;
  score: number;
}

export function parseTuSave(raw: string | null, now = Date.now()): TuSave | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<TuSave>;
    if (!s || s.v !== 1) return null;
    if (typeof s.runId !== "string" || !s.runId || typeof s.seed !== "string") return null;
    if (!Array.isArray(s.tiers) || s.tiers.length < 2 || !Array.isArray(s.taps) || s.taps.length < 1) return null;
    if (typeof s.expiresAt !== "string" || !(Date.parse(s.expiresAt) > now)) return null;
    if (typeof s.score !== "number" || typeof s.nickname !== "string") return null;
    return s as TuSave;
  } catch {
    return null;
  }
}

export function readTuSave(now = Date.now()): TuSave | null {
  try {
    window.localStorage.removeItem(OLD_SAVE_KEY);
    const raw = window.localStorage.getItem(TU_SAVE_KEY);
    const s = parseTuSave(raw, now);
    if (!s && raw) clearTuSave();
    return s;
  } catch {
    return null;
  }
}

export function writeTuSave(s: TuSave): void {
  try {
    window.localStorage.setItem(TU_SAVE_KEY, JSON.stringify(s));
  } catch {
    /* private mode or full: no save */
  }
}

export function clearTuSave(): void {
  try {
    window.localStorage.removeItem(TU_SAVE_KEY);
  } catch {
    /* ignore */
  }
}

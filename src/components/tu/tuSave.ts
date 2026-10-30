// The autosave of the 兔了个兔 run in progress (D124 = D111): this phone only; resume replays the taps.
import { MAX_TAPS, TU_ENGINE_VERSION } from "@/lib/tu";
import type { TierView } from "@/components/game/types";
import type { TuTapLog } from "./tuApi";

// Saves from another engine version cannot be replayed under the current rules.
export const TU_SAVE_KEY = `bb_tu_save_v${TU_ENGINE_VERSION}`;

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
    if (!Array.isArray(s.tiers) || s.tiers.length < 2 || !Array.isArray(s.taps) || s.taps.length < 1 || s.taps.length > MAX_TAPS) return null;
    if (typeof s.expiresAt !== "string" || !(Date.parse(s.expiresAt) > now)) return null;
    if (typeof s.score !== "number" || typeof s.nickname !== "string") return null;
    return s as TuSave;
  } catch {
    return null;
  }
}

export function readTuSave(now = Date.now()): TuSave | null {
  try {
    const storage = window.localStorage;
    // Walk backwards because removing a key shifts the remaining storage indices.
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (key?.startsWith("bb_tu_save_v") && key !== TU_SAVE_KEY) storage.removeItem(key);
    }
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

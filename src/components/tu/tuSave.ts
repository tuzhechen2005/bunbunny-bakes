// The autosave of the 兔了个兔 run in progress (D124 = D111): this phone only; resume replays the taps.
import { MAX_TAPS, TU_ENGINE_VERSION } from "@/lib/tu";
import { isSupportedTuSeed, tuSeedVersion } from "@/lib/tu/version";
import type { TierView } from "@/components/game/types";
import type { TuTapLog } from "./tuApi";

export const TU_SAVE_KEY = `bb_tu_save_v${TU_ENGINE_VERSION}`;
/** Versions whose runs in progress stay playable under their own rules (D188/D189: "不要动正在玩的局"). */
const KEPT_VERSIONS = [TU_ENGINE_VERSION, 5];
const keyFor = (version: number) => `bb_tu_save_v${version}`;

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
    if (typeof s.runId !== "string" || !s.runId || typeof s.seed !== "string" || !isSupportedTuSeed(s.seed)) return null;
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
      if (key?.startsWith("bb_tu_save_v") && !KEPT_VERSIONS.some((v) => key === keyFor(v))) storage.removeItem(key);
    }
    for (const version of KEPT_VERSIONS) {
      const raw = storage.getItem(keyFor(version));
      const s = parseTuSave(raw, now);
      if (s) return s;
      if (raw) storage.removeItem(keyFor(version));
    }
    return null;
  } catch {
    return null;
  }
}

/** One run per phone, stored under its own version's key. */
export function writeTuSave(s: TuSave): void {
  try {
    const own = keyFor(tuSeedVersion(s.seed));
    for (const version of KEPT_VERSIONS) if (keyFor(version) !== own) window.localStorage.removeItem(keyFor(version));
    window.localStorage.setItem(own, JSON.stringify(s));
  } catch {
    /* private mode or full: no save */
  }
}

export function clearTuSave(): void {
  try {
    for (const version of KEPT_VERSIONS) window.localStorage.removeItem(keyFor(version));
  } catch {
    /* ignore */
  }
}

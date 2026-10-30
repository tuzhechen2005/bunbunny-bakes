// M3 autosave (D135/D142): this phone only; resume replays accepted moves.
import { MAX_MOVES, M3_ENGINE_VERSION, replayM3, type M3Move } from "@/lib/m3";
import type { TierView } from "@/components/game/types";

// Saves from another engine version cannot be replayed under the current rules.
export const M3_SAVE_KEY = `bb_m3_save_v${M3_ENGINE_VERSION}`;

export interface M3Save {
  v: 1;
  runId: string;
  seed: string;
  tiers: TierView[];
  moves: M3Move[];
  nickname: string;
  /** ISO instant: the weekly reset after which the run can no longer be finished. */
  expiresAt: string;
  score: number;
}

export function parseM3Save(raw: string | null, now = Date.now()): M3Save | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<M3Save>;
    if (!s || s.v !== 1) return null;
    if (typeof s.runId !== "string" || !s.runId || typeof s.seed !== "string") return null;
    if (!Array.isArray(s.tiers) || s.tiers.length !== 6 || !Array.isArray(s.moves) || s.moves.length > MAX_MOVES) return null;
    if (typeof s.expiresAt !== "string" || !(Date.parse(s.expiresAt) > now)) return null;
    if (typeof s.score !== "number" || typeof s.nickname !== "string") return null;
    if (!s.tiers.every(t => t && typeof t.id === "string" && typeof t.radius === "number" && typeof t.points === "number" && (t.imageUrl === null || typeof t.imageUrl === "string") && t.color && typeof t.color.bg === "string" && typeof t.color.ink === "string" && (t.name === undefined || typeof t.name === "string"))) return null;
    if (replayM3(s.seed, s.tiers, s.moves).score !== s.score) return null;
    return s as M3Save;
  } catch {
    return null;
  }
}

export function readM3Save(now = Date.now()): M3Save | null {
  try {
    const storage = window.localStorage;
    // Walk backwards because removing a key shifts the remaining storage indices.
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (key?.startsWith("bb_m3_save_v") && key !== M3_SAVE_KEY) storage.removeItem(key);
    }
    const raw = window.localStorage.getItem(M3_SAVE_KEY);
    const s = parseM3Save(raw, now);
    if (!s && raw) clearM3Save();
    return s;
  } catch {
    return null;
  }
}

export function writeM3Save(s: M3Save): void {
  try {
    window.localStorage.setItem(M3_SAVE_KEY, JSON.stringify(s));
  } catch {
    /* private mode or full: no save */
  }
}

export function clearM3Save(): void {
  try {
    window.localStorage.removeItem(M3_SAVE_KEY);
  } catch {
    /* ignore */
  }
}

// The autosave of the run in progress (D111). Stored on this phone only; the server keeps the run record.
import type { DropLog, TierView } from "./types";

export const SAVE_KEY = "bb_game_save_v1";

export interface GameSave {
  v: 1;
  runId: string;
  seed: string;
  tiers: TierView[];
  drops: DropLog[];
  nickname: string;
  /** ISO instant: the weekly reset after which the run can no longer be finished. */
  expiresAt: string;
  score: number;
}

/** Parses a stored save; null for anything unusable or already expired. */
export function parseSave(raw: string | null, now = Date.now()): GameSave | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<GameSave>;
    if (!s || s.v !== 1) return null;
    if (typeof s.runId !== "string" || !s.runId || typeof s.seed !== "string") return null;
    if (!Array.isArray(s.tiers) || s.tiers.length < 3 || !Array.isArray(s.drops) || s.drops.length < 1) return null;
    if (typeof s.expiresAt !== "string" || !(Date.parse(s.expiresAt) > now)) return null;
    if (typeof s.score !== "number" || typeof s.nickname !== "string") return null;
    return s as GameSave;
  } catch {
    return null;
  }
}

/** The valid save, or null; an unusable or expired one is deleted on the way. */
export function readSave(now = Date.now()): GameSave | null {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    const s = parseSave(raw, now);
    if (!s && raw) clearSave();
    return s;
  } catch {
    return null;
  }
}

export function writeSave(s: GameSave): void {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch {
    /* private mode or full: no save */
  }
}

export function clearSave(): void {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

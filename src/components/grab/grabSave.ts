// Grab autosave (D145): this phone only; resume replays accepted launches.
import { MAX_LAUNCHES, GRAB_ENGINE_VERSION, replayGrab, grabSeedVersion, MAX_RUN_TICKS } from "@/lib/grab";
import { elapsedTick } from "./grabClock";
import type { TierView } from "@/components/game/types";

// Saves from another engine version cannot be replayed under the current rules.
export const GRAB_SAVE_KEY = `bb_grab_save_v${GRAB_ENGINE_VERSION}`;

export interface GrabSave {
  v: 1;
  runId: string;
  seed: string;
  tiers: TierView[];
  launches: number[];
  elapsedMs: number;
  nickname: string;
  /** ISO instant: the weekly reset after which the run can no longer be finished. */
  expiresAt: string;
  score: number;
}

export function parseGrabSave(raw: string | null, now = Date.now()): GrabSave | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<GrabSave>;
    if (!s || s.v !== 1) return null;
    if (typeof s.runId !== "string" || !s.runId || typeof s.seed !== "string") return null;
    if (!Array.isArray(s.tiers) || s.tiers.length < 3 || !Array.isArray(s.launches) || s.launches.length > MAX_LAUNCHES) return null;
    if (grabSeedVersion(s.seed) !== GRAB_ENGINE_VERSION || typeof s.elapsedMs !== "number" || !Number.isFinite(s.elapsedMs) || s.elapsedMs < 0 || s.elapsedMs > MAX_RUN_TICKS * 1000 / 60) return null;
    if (typeof s.expiresAt !== "string" || !(Date.parse(s.expiresAt) > now)) return null;
    if (typeof s.score !== "number" || typeof s.nickname !== "string") return null;
    if (!s.tiers.every(t => t && typeof t.id === "string" && typeof t.radius === "number" && typeof t.points === "number" && (t.imageUrl === null || typeof t.imageUrl === "string") && t.color && typeof t.color.bg === "string" && typeof t.color.ink === "string" && (t.name === undefined || typeof t.name === "string"))) return null;
    if (s.tiers.some(t => !t.id || t.id === "big") || new Set(s.tiers.map(t => t.id)).size !== s.tiers.length) return null;
    if (replayGrab(s.seed, s.tiers, s.launches, elapsedTick(s.elapsedMs)).score !== s.score) return null;
    return s as GrabSave;
  } catch {
    return null;
  }
}

export function readGrabSave(now = Date.now()): GrabSave | null {
  try {
    const storage = window.localStorage;
    // Walk backwards because removing a key shifts the remaining storage indices.
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (key?.startsWith("bb_grab_save_v") && key !== GRAB_SAVE_KEY) storage.removeItem(key);
    }
    const raw = window.localStorage.getItem(GRAB_SAVE_KEY);
    const s = parseGrabSave(raw, now);
    if (!s && raw) clearGrabSave();
    return s;
  } catch {
    return null;
  }
}

export function writeGrabSave(s: GrabSave): void {
  try {
    window.localStorage.setItem(GRAB_SAVE_KEY, JSON.stringify(s));
  } catch {
    /* private mode or full: no save */
  }
}

export function clearGrabSave(): void {
  try {
    window.localStorage.removeItem(GRAB_SAVE_KEY);
  } catch {
    /* ignore */
  }
}

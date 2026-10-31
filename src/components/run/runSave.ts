// Run autosave (D146): this phone only; resume replays accepted inputs.
import { MAX_INPUTS, RUN_ENGINE_VERSION, replayRun, runSeedVersion, MAX_RUN_TICKS } from "@/lib/run";
import { elapsedTick } from "./runClock";
import type { RunInput } from "@/lib/run";

// Saves from another engine version cannot be replayed under the current rules.
export const RUN_SAVE_KEY = `bb_run_save_v${RUN_ENGINE_VERSION}`;

export interface RunSave {
  v: 1;
  runId: string;
  seed: string;
  inputs: RunInput[];
  elapsedMs: number;
  nickname: string;
  /** ISO instant: the weekly reset after which the run can no longer be finished. */
  expiresAt: string;
  score: number;
}

export function parseRunSave(raw: string | null, now = Date.now()): RunSave | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<RunSave>;
    if (!s || s.v !== 1) return null;
    if (typeof s.runId !== "string" || !s.runId || typeof s.seed !== "string") return null;
    if (!Array.isArray(s.inputs) || s.inputs.length > MAX_INPUTS) return null;
    if (runSeedVersion(s.seed) !== RUN_ENGINE_VERSION || typeof s.elapsedMs !== "number" || !Number.isFinite(s.elapsedMs) || s.elapsedMs < 0 || s.elapsedMs > MAX_RUN_TICKS * 1000 / 60) return null;
    if (typeof s.expiresAt !== "string" || !(Date.parse(s.expiresAt) > now)) return null;
    if (typeof s.score !== "number" || typeof s.nickname !== "string") return null;
    const outcome = replayRun(s.seed, s.inputs, elapsedTick(s.elapsedMs));
    if (outcome.score !== s.score || outcome.endTick !== elapsedTick(s.elapsedMs)) return null;
    return s as RunSave;
  } catch {
    return null;
  }
}

export function readRunSave(now = Date.now()): RunSave | null {
  try {
    const storage = window.localStorage;
    // Walk backwards because removing a key shifts the remaining storage indices.
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (key?.startsWith("bb_run_save_v") && key !== RUN_SAVE_KEY) storage.removeItem(key);
    }
    const raw = window.localStorage.getItem(RUN_SAVE_KEY);
    const s = parseRunSave(raw, now);
    if (!s && raw) clearRunSave();
    return s;
  } catch {
    return null;
  }
}

export function writeRunSave(s: RunSave): void {
  try {
    window.localStorage.setItem(RUN_SAVE_KEY, JSON.stringify(s));
  } catch {
    /* private mode or full: no save */
  }
}

export function clearRunSave(): void {
  try {
    window.localStorage.removeItem(RUN_SAVE_KEY);
  } catch {
    /* ignore */
  }
}

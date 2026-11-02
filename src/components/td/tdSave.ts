import { replayTd, tdLevelFromSeed, tdSeedVersion, TD_ENGINE_VERSION, type TdInput } from '@/lib/td';
import type { TdStartedRun } from './tdApi';
export const TD_SAVE_KEY = `bb_td_save_v${TD_ENGINE_VERSION}`;
/** Engine versions whose runs in progress stay playable (D188, owner 11/02 "不要动正在玩的局"). */
const KEPT_VERSIONS = [TD_ENGINE_VERSION, 13];
const keyFor = (version: number) => `bb_td_save_v${version}`;
export interface TdSave extends TdStartedRun {
  v: 1; nickname: string; inputs: TdInput[]; endTick: number; score: number;
}
export function parseTdSave(raw: string | null, now = Date.now()): TdSave | null {
  try {
    if (!raw) return null;
    const s = JSON.parse(raw) as TdSave;
    if (s.v !== 1 || typeof s.runId !== 'string' || !/^[\da-f-]{36}$/i.test(s.runId)
      || typeof s.nickname !== 'string' || !(Date.parse(s.expiresAt) > now)
      || !Array.isArray(s.tiers) || !s.tiers.length || s.tiers.length > 100
      || !s.tiers.every(t => t && typeof t.id === 'string' && typeof t.radius === 'number' && typeof t.points === 'number'
        && (t.imageUrl === null || typeof t.imageUrl === 'string') && typeof t.color?.bg === 'string' && typeof t.color?.ink === 'string')
      || !KEPT_VERSIONS.includes(tdSeedVersion(s.seed) ?? -1)) return null;
    // The seed carries its own rules version; it must describe exactly this saved level.
    const level = tdLevelFromSeed(s.seed);
    if (level.weekKey !== s.weekKey || level.number !== s.level) return null;
    const state = replayTd({ seed: s.seed, tierCount: s.tiers.length, itemsAllowed: s.inventory ?? {} }, s.inputs, s.endTick);
    return state.tick === s.endTick && state.wave === s.score ? s : null;
  } catch { return null; }
}
export function readTdSave(): TdSave | null {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith('bb_td_save_v') && !KEPT_VERSIONS.some(v => key === keyFor(v))) localStorage.removeItem(key);
    }
    for (const version of KEPT_VERSIONS) {
      const raw = localStorage.getItem(keyFor(version)), save = parseTdSave(raw);
      if (save) return save;
      if (raw) localStorage.removeItem(keyFor(version));
    }
    return null;
  } catch { return null; }
}
/** One active run per phone: it is stored under its own version's key, any other kept key is cleared. */
export function writeTdSave(save: TdSave) {
  try {
    const own = keyFor(tdSeedVersion(save.seed) ?? TD_ENGINE_VERSION);
    for (const version of KEPT_VERSIONS) if (keyFor(version) !== own) localStorage.removeItem(keyFor(version));
    localStorage.setItem(own, JSON.stringify(save));
  } catch { /* Optional local persistence. */ }
}
export function clearTdSave() { try { for (const version of KEPT_VERSIONS) localStorage.removeItem(keyFor(version)); } catch { /* Private browsing. */ } }

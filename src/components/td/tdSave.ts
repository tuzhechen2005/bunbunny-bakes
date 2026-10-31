import { replayTd, tdLevel, TD_ENGINE_VERSION, type TdInput } from '@/lib/td';
import type { TdStartedRun } from './tdApi';
export const TD_SAVE_KEY = `bb_td_save_v${TD_ENGINE_VERSION}`;
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
      || s.seed !== tdLevel(s.weekKey, s.level).seed) return null;
    const state = replayTd({ seed: s.seed, tierCount: s.tiers.length }, s.inputs, s.endTick);
    return state.tick === s.endTick && state.wave === s.score ? s : null;
  } catch { return null; }
}
export function readTdSave(): TdSave | null {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith('bb_td_save_v') && key !== TD_SAVE_KEY) localStorage.removeItem(key);
    }
    const raw = localStorage.getItem(TD_SAVE_KEY), save = parseTdSave(raw);
    if (raw && !save) clearTdSave();
    return save;
  } catch { return null; }
}
export function writeTdSave(save: TdSave) { try { localStorage.setItem(TD_SAVE_KEY, JSON.stringify(save)); } catch { /* Optional local persistence. */ } }
export function clearTdSave() { try { localStorage.removeItem(TD_SAVE_KEY); } catch { /* Private browsing. */ } }

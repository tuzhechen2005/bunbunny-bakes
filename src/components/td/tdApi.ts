import { call } from '@/components/game/gameApi';
import type { StartedRun, FinishResult, Leaderboard } from '@/components/game/types';
import type { TdInput, TdItem } from '@/lib/td';
/** inventory: the shop items owned at start; each can be used once per run (D9). */
export type TdStartedRun = StartedRun & { level: number; weekKey: string; inventory?: Partial<Record<TdItem, number>> };
export type TdFinish = FinishResult & { level: number; passed: boolean };
export const startTd = (wechatId: string, nickname: string, level?: number) => call<TdStartedRun>('/api/game/td/start', { wechatId, nickname, level });
export const finishTd = (runId: string, inputs: TdInput[], endTick: number) => call<TdFinish>('/api/game/td/finish', { runId, inputs, endTick });
export const fetchTdLeaderboard = (wechatId?: string) => call<Leaderboard & { nextLevel: number }>(`/api/game/td/leaderboard${wechatId ? `?wechatId=${encodeURIComponent(wechatId)}` : ''}`);

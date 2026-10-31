import { call } from "@/components/game/gameApi";
import type { FinishResult, Leaderboard, StartedRun } from "@/components/game/types";
import type { M3Move, M3Level } from "@/lib/m3";

export type M3StartedRun = StartedRun & M3Level & { level: number; weekKey: string; nickname?: string };
export type M3Finish = FinishResult & { level: number; passed: boolean };
export const startM3 = (wechatId: string, nickname: string, level?: number) =>
  call<M3StartedRun>("/api/game/m3/start", { wechatId, nickname, level });
export const finishM3 = (runId: string, moves: M3Move[]) =>
  call<M3Finish>("/api/game/m3/finish", { runId, moves });
export const fetchM3Leaderboard = (wechatId?: string) =>
  call<Leaderboard & { nextLevel: number }>(`/api/game/m3/leaderboard${wechatId ? `?wechatId=${encodeURIComponent(wechatId)}` : ""}`);

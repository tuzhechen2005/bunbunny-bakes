import { call } from "@/components/game/gameApi";
import type { FinishResult, Leaderboard, StartedRun } from "@/components/game/types";
import type { M3Move } from "@/lib/m3";

export const startM3 = (wechatId: string, nickname: string) =>
  call<StartedRun & { nickname?: string }>("/api/game/m3/start", { wechatId, nickname });
export const finishM3 = (runId: string, moves: M3Move[]) =>
  call<FinishResult>("/api/game/m3/finish", { runId, moves });
export const fetchM3Leaderboard = (wechatId?: string) =>
  call<Leaderboard>(`/api/game/m3/leaderboard${wechatId ? `?wechatId=${encodeURIComponent(wechatId)}` : ""}`);

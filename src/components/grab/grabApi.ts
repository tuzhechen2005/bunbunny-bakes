import { call } from "@/components/game/gameApi";
import type { FinishResult, Leaderboard, StartedRun } from "@/components/game/types";

export const startGrab = (wechatId: string, nickname: string) =>
  call<StartedRun & { nickname?: string }>("/api/game/grab/start", { wechatId, nickname });
export const finishGrab = (runId: string, launches: number[], endTick: number) =>
  call<FinishResult>("/api/game/grab/finish", { runId, launches, endTick });
export const fetchGrabLeaderboard = (wechatId?: string) =>
  call<Leaderboard>(`/api/game/grab/leaderboard${wechatId ? `?wechatId=${encodeURIComponent(wechatId)}` : ""}`);

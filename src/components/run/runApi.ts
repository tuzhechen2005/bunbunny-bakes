import type { RunInput } from "@/lib/run";
import { call } from "@/components/game/gameApi";
import type { FinishResult, Leaderboard, StartedRun } from "@/components/game/types";

export const startRun = (wechatId: string, nickname: string) =>
  call<Omit<StartedRun, "tiers"> & { nickname?: string }>("/api/game/run/start", { wechatId, nickname });
export const finishRun = (runId: string, inputs: RunInput[], endTick: number) =>
  call<FinishResult>("/api/game/run/finish", { runId, inputs, endTick });
export const fetchRunLeaderboard = (wechatId?: string) =>
  call<Leaderboard>(`/api/game/run/leaderboard${wechatId ? `?wechatId=${encodeURIComponent(wechatId)}` : ""}`);

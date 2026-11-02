import type { RunInput, RunStartMode } from "@/lib/run";
import { call } from "@/components/game/gameApi";
import type { FinishResult, Leaderboard, StartedRun } from "@/components/game/types";

export const startRun = (wechatId: string, nickname: string, startMode: RunStartMode = "normal") =>
  call<Omit<StartedRun, "tiers"> & { nickname?: string; startMode?: RunStartMode }>("/api/game/run/start", startMode === "normal" ? { wechatId, nickname } : { wechatId, nickname, startMode });
export const finishRun = (runId: string, inputs: RunInput[], endTick: number) =>
  call<FinishResult>("/api/game/run/finish", { runId, inputs, endTick });
export const fetchRunLeaderboard = (wechatId?: string) =>
  call<Leaderboard>(`/api/game/run/leaderboard${wechatId ? `?wechatId=${encodeURIComponent(wechatId)}` : ""}`);

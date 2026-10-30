// Client for the 兔了个兔 API (contract C6): same shapes as the first game's, other paths.
import { call } from "@/components/game/gameApi";
import type { FinishResult, Leaderboard, StartedRun } from "@/components/game/types";

/** One log entry (C8): a tile tap `{ id, at }` or a prop use `{ p, at }`; `at` is integer ms since the run started. */
export type TuTapLog = { id: number; at: number } | { p: "peek" | "bag" | "swap"; at: number };

export const startTu = (wechatId: string, nickname: string) => call<StartedRun>("/api/game/tu/start", { wechatId, nickname });

export const finishTu = (runId: string, taps: TuTapLog[]) => call<FinishResult>("/api/game/tu/finish", { runId, taps });

export const fetchTuLeaderboard = (wechatId?: string) =>
  call<Leaderboard>(`/api/game/tu/leaderboard${wechatId ? `?wechatId=${encodeURIComponent(wechatId)}` : ""}`);

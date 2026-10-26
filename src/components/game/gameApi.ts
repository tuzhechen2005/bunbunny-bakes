// Client for the game API (L1 contract). Never throws: resolves to { ok, data } or { ok: false, error }.
import { copy } from "@/copy";
import type { ApiResult } from "@/lib/api";
import type { DropLog, FinishResult, Leaderboard, StartedRun } from "./types";

/** A stalled phone connection must end in a retry button, not in a spinner that never stops. */
export const REQUEST_TIMEOUT_MS = 15_000;

async function call<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
  let response: Response;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  try {
    response = await fetch(path, {
      signal: ctl.signal,
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    clearTimeout(timer);
    return { ok: false, status: 0, error: { error: "NETWORK", message: copy.errors.fallback } };
  }
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    /* not JSON (or the body stalled and was aborted) */
  }
  clearTimeout(timer);
  if (response.ok && json !== null) return { ok: true, status: response.status, data: json as T };
  const b = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  return {
    ok: false,
    status: response.status,
    error: {
      error: typeof b.error === "string" ? b.error : "UNKNOWN",
      message: typeof b.message === "string" && b.message ? b.message : copy.errors.fallback,
    },
  };
}

export const startRun = (wechatId: string, nickname: string) =>
  call<StartedRun>("/api/game/start", { wechatId, nickname });

export const finishRun = (runId: string, drops: DropLog[]) =>
  call<FinishResult>("/api/game/finish", { runId, drops });

export const fetchLeaderboard = (wechatId?: string) =>
  call<Leaderboard>(`/api/game/leaderboard${wechatId ? `?wechatId=${encodeURIComponent(wechatId)}` : ""}`);

/** Network trouble and server errors can be retried with the same run; everything else cannot. */
export const isRetryable = (status: number) => status === 0 || status === 429 || status >= 500;

const KEY = "bb_game_v1";
export interface Remembered {
  wechatId: string;
  nickname: string;
  sound: boolean;
}

export function readRemembered(): Remembered {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Partial<Remembered>;
    return {
      wechatId: typeof v.wechatId === "string" ? v.wechatId : "",
      nickname: typeof v.nickname === "string" ? v.nickname : "",
      sound: v.sound === true,
    };
  } catch {
    return { wechatId: "", nickname: "", sound: false };
  }
}

export function writeRemembered(patch: Partial<Remembered>): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...readRemembered(), ...patch }));
  } catch {
    /* private mode: nothing is remembered */
  }
}

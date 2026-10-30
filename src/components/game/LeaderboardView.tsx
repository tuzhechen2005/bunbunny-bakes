"use client";

import { useEffect, useState } from "react";
import { copy } from "@/copy";
import { focusRing } from "@/components/ui/focus";
import { fill } from "@/components/customer/format";
import { fetchLeaderboard } from "./gameApi";
import type { Leaderboard } from "./types";

const t = copy.customer.game;

type State = { status: "loading" } | { status: "error" } | { status: "ready"; data: Leaderboard };

/** "2026-10-26T05:00:00Z" -> "10/26" (the date part as the server wrote it). */
function md(s: string): string {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${Number(m[2])}/${Number(m[3])}` : s;
}

/** Top 20 of the week, last week's winner and the player's own best. */
export function LeaderboardView({
  wechatId,
  version = 0,
  hasPrize = false,
  fetcher = fetchLeaderboard,
}: {
  wechatId: string;
  version?: number;
  hasPrize?: boolean;
  /** Which game's board (the first game's by default). */
  fetcher?: typeof fetchLeaderboard;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    fetcher(wechatId || undefined).then((r) => {
      if (!alive) return;
      setState(r.ok && r.data && Array.isArray(r.data.top) ? { status: "ready", data: r.data } : { status: "error" });
    });
    return () => {
      alive = false;
    };
  }, [wechatId, attempt, version, fetcher]);

  if (state.status === "loading") {
    return (
      <p className="px-5 py-10 text-center text-sm text-c-grey" role="status">
        {t.boardLoading}
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <div className="px-5 py-10 text-center">
        <p className="text-sm text-c-red" role="alert">
          {t.boardFailed}
        </p>
        <button
          type="button"
          onClick={() => {
            setState({ status: "loading" });
            setAttempt((n) => n + 1);
          }}
          className={`mt-3 min-h-11 rounded-full bg-c-wash px-5 text-sm font-bold text-c-ink ${focusRing}`}
        >
          {t.retry}
        </button>
      </div>
    );
  }
  const { data } = state;
  return (
    <div className="px-5 pb-8" data-testid="game-board-list">
      {data.allTime ? (
        <div className="mb-4 rounded-2xl bg-c-wash px-4 py-3" data-testid="game-all-time">
          <p className="m-0 text-xs font-bold text-c-grey">{t.crown}</p>
          <p className="m-0 mt-1 flex items-baseline justify-between gap-3">
            <span className="font-display min-w-0 truncate text-[15px] text-c-ink">
              {data.allTime.nickname} <span className="font-num text-xs text-c-grey">{data.allTime.wechatMasked}</span>
            </span>
            <span className="font-num text-xl text-c-ink">{data.allTime.score}</span>
          </p>
        </div>
      ) : null}
      <p className="m-0 text-[13px] text-c-grey">{fill(t.weekRange, { start: md(data.week.start), end: md(data.week.end) })}</p>
      {typeof data.myBest === "number" ? (
        <p className="mt-3 flex items-baseline justify-between rounded-2xl bg-c-wash px-4 py-3 text-sm font-bold text-c-ink" data-testid="game-my-best">
          <span>{t.myBest}</span>
          <span className="font-num text-xl">{data.myBest}</span>
        </p>
      ) : null}
      {data.top.length === 0 ? (
        <p className="py-10 text-center text-sm text-c-grey" data-testid="game-board-empty">
          {t.empty}
        </p>
      ) : (
        <ol className="mt-3 list-none p-0">
          {data.top.map((row) => (
            <li key={`${row.rank}-${row.wechatMasked}`} className="flex min-h-12 items-center gap-3 border-b border-c-line py-2" data-testid="game-row">
              <span className="font-num w-7 shrink-0 text-center text-lg text-c-ink">{row.rank}</span>
              <span className="min-w-0 flex-1">
                <b className="font-display block truncate text-[15px] text-c-ink">{row.nickname}</b>
                <span className="font-num block text-xs text-c-grey">{row.wechatMasked}</span>
              </span>
              {hasPrize && row.rank === 1 ? (
                <span role="img" aria-label={t.prizeMarkLabel} className="text-lg leading-none" data-testid="game-prize-mark">
                  {t.prizeMark}
                </span>
              ) : null}
              <span className="font-num text-xl text-c-ink">{row.score}</span>
            </li>
          ))}
        </ol>
      )}
      {data.lastWinner ? (
        <div className="mt-5 rounded-2xl border border-c-line px-4 py-3" data-testid="game-last-winner">
          <p className="m-0 text-xs font-bold text-c-grey">{t.lastWinner}</p>
          <p className="m-0 mt-1 flex items-baseline justify-between gap-3">
            <span className="font-display min-w-0 truncate text-[15px] text-c-ink">
              {data.lastWinner.nickname} <span className="font-num text-xs text-c-grey">{data.lastWinner.wechatMasked}</span>
            </span>
            <span className="font-num text-xl text-c-ink">{data.lastWinner.score}</span>
          </p>
        </div>
      ) : null}
    </div>
  );
}

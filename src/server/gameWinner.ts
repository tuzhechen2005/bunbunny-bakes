// Weekly game winner email (D114, docs/NOTIFICATIONS.md): on Monday morning the owner gets last
// week's #1 with the full WeChat id and whether they have ordered (the prize condition). If #1 has
// not ordered, the email also names the highest-ranked player who has; the owner decides.
// One GAME_WINNER notification per week (dedupeKey game_winner:<weekKey>).

import type { LocalDate } from "@/domain/types";
import type { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "./db";
import { rankedWeek } from "./game";
import { orderedSet } from "./gameAdmin";
import { previousWeekKey, weekKeyOf, weekRange } from "./gameWeek";
import { enqueueNotification } from "./outbox";

export interface WinnerLine {
  rank: number;
  nickname: string;
  /** Full WeChat id: this email goes to the owner only. */
  wechatId: string;
  score: number;
  ordered: boolean;
}

export interface GameWinnerPayload {
  weekKey: LocalDate;
  week: { start: LocalDate; end: LocalDate };
  winner: WinnerLine;
  /** Only when the winner has not ordered: the highest-ranked player who has (null if nobody). */
  runnerUp: WinnerLine | null;
  siteUrl: string;
}

export type GameWinnerJobResult =
  | { status: "empty" }
  | { status: "enqueued"; notificationId: string }
  | { status: "duplicate" };

export const gameWinnerDedupeKey = (weekKey: LocalDate) => `game_winner:${weekKey}`;

/** Last week's (just closed) board as the email payload; null when nobody counts on it. */
export async function loadGameWinner(db: DbClient, now: Date): Promise<GameWinnerPayload | null> {
  const weekKey = previousWeekKey(weekKeyOf(now));
  const rows = await rankedWeek(db, weekKey);
  if (rows.length === 0) return null;
  const ordered = await orderedSet(db, rows.map((r) => r.wechatId));
  const lines: WinnerLine[] = rows.map((r) => ({
    rank: r.rank,
    nickname: r.nickname,
    wechatId: r.wechatId,
    score: r.score,
    ordered: ordered.has(r.wechatId.trim().toLowerCase()),
  }));
  const winner = lines[0];
  const runnerUp = winner.ordered ? null : (lines.find((l) => l.ordered) ?? null);
  const siteUrl = (process.env.SITE_URL ?? "").replace(/\/+$/, "");
  return { weekKey, week: weekRange(weekKey), winner, runnerUp, siteUrl };
}

/** Enqueues last week's winner email unless the week had no runs or it was already enqueued. */
export async function enqueueGameWinner(db: DbClient, now: Date): Promise<GameWinnerJobResult> {
  const payload = await loadGameWinner(db, now);
  if (!payload) return { status: "empty" };
  const result = await db.$transaction((tx) =>
    enqueueNotification(tx, {
      kind: "GAME_WINNER",
      dedupeKey: gameWinnerDedupeKey(payload.weekKey),
      payload: payload as unknown as Prisma.InputJsonValue,
      now,
    }),
  );
  return result.created ? { status: "enqueued", notificationId: result.id } : { status: "duplicate" };
}

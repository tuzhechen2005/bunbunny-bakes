"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { dangerBtn, inputClass, primaryBtn, secondaryBtn, Sheet } from "@/components/admin/orders/shared";
import { fill } from "@/components/customer/format";
import { copy } from "@/copy";
import { monthDay } from "@/domain/dates";
import { adminApi } from "@/lib/adminApi";

const t = copy.admin.game;
const PAGE = 20;

interface Row {
  id: string;
  wechatId: string;
  nickname: string;
  score: number;
  finishedAt: string | null;
  updatedAt?: string | null;
  verified: boolean;
  hidden: boolean;
  banned: boolean;
  ordered: boolean;
  dropCount: number | null;
  durationSec: number | null;
  /** 兔了个兔 only (D103 manual check); absent / false for the first game. */
  suspicious?: boolean;
  rank: number | null;
}
interface Winner {
  weekKey: string;
  contactedAt: string | null;
  redeemedAt: string | null;
  note: string;
  wechatId: string;
  nickname: string;
  score: number;
  ordered: boolean;
  stored: boolean;
}
interface Board {
  week: string;
  currentWeek: string;
  weeks: string[];
  rows: Row[];
  winner: Winner | null;
  bans: { wechatId: string; reason: string | null; createdAt: string }[];
}

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  hourCycle: "h23",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const timeLabel = (iso: string) => timeFmt.format(new Date(iso)).replace(",", "");

const chip = "inline-flex items-center rounded-full border border-line px-2 py-0.5 text-sm";

export function BoardPanel({ game = "big" }: { game?: "big" | "tu" | "m3" | "grab" | "run" }) {
  // The query selects a game; absent means BIG. Bans are shared across all three.
  const q = game === "big" ? "" : `game=${game}`;
  const withGame = (path: string) => (q ? `${path}${path.includes("?") ? "&" : "?"}${q}` : path);
  const [week, setWeek] = useState<string | undefined>(undefined);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [banFor, setBanFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);

  const load = useCallback(async (wk: string | undefined) => {
    const r = await adminApi<Board>(withGame(`/api/admin/game/leaderboard${wk ? `?week=${wk}` : ""}`));
    if (r.ok) {
      setBoard(r.data);
      setNote(r.data.winner?.note ?? "");
      setError("");
    } else setError(r.message || t.loadFailed);
  // `withGame` is rebuilt every render but only depends on `game`, so `game` is the real dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game]);
  useEffect(() => {
    // Initial fetch: the state is set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(week);
  }, [load, week]);

  async function write(path: string, method: string, body?: unknown) {
    setBusy(true);
    setError("");
    const r = await adminApi(path.startsWith("/api/admin/game/bans") ? path : withGame(path), { method, body });
    setBusy(false);
    if (!r.ok) {
      if (r.error !== "UNAUTHORIZED") setError(r.message);
      return false;
    }
    await load(week);
    return true;
  }

  if (!board) {
    return error ? (
      <p role="alert" className="text-sm text-danger">
        {error}{" "}
        <button type="button" className="min-h-11 underline" onClick={() => void load(week)}>
          {t.retry}
        </button>
      </p>
    ) : (
      <p className="text-muted">{t.loading}</p>
    );
  }

  const weekName = (wk: string) =>
    (wk === board.currentWeek ? `${t.weekCurrent} · ` : "") + fill(t.weekLabel, { start: monthDay(wk) });
  const w = board.winner;
  const isCurrent = board.week === board.currentWeek;

  return (
    <div className="flex flex-col gap-3" data-testid="board-panel">
      <label className="flex flex-col gap-1 text-sm text-muted">
        {t.boardWeek}
        <select className={inputClass} value={board.week} onChange={(e) => { setWeek(e.target.value); setShown(PAGE); }} data-testid="board-week">
          {board.weeks.map((wk) => (
            <option key={wk} value={wk}>
              {weekName(wk)}
            </option>
          ))}
        </select>
      </label>
      {error ? (
        <p role="alert" className="text-sm text-danger" data-testid="board-error">
          {error}
        </p>
      ) : null}

      <AdminCard title={isCurrent ? t.winnerTitle : t.winnerTitlePast}>
        {w ? (
          <div data-testid="winner-card">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="min-w-0 break-all">
                <span className="text-lg font-semibold">{w.nickname}</span>{" "}
                <span className="text-muted" data-testid="winner-wechat">{w.wechatId}</span>
              </div>
              <span className="text-lg font-semibold">{w.score}</span>
            </div>
            <div className="mt-1">
              <span className={chip} data-testid="winner-ordered">{w.ordered ? t.ordered : t.notOrdered}</span>
            </div>
            <div className="mt-3 flex flex-col gap-1">
              <label className="flex min-h-11 items-center gap-2 text-base">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={!!w.contactedAt}
                  disabled={busy}
                  onChange={(e) => void write("/api/admin/game/award", "PATCH", { week: board.week, contacted: e.target.checked })}
                  data-testid="award-contacted"
                />
                {t.contacted}
              </label>
              <label className="flex min-h-11 items-center gap-2 text-base">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={!!w.redeemedAt}
                  disabled={busy}
                  onChange={(e) => void write("/api/admin/game/award", "PATCH", { week: board.week, redeemed: e.target.checked })}
                  data-testid="award-redeemed"
                />
                {t.redeemed}
              </label>
            </div>
            <div className="mt-2 flex flex-col gap-2">
              <input
                className={inputClass}
                value={note}
                maxLength={500}
                aria-label={t.note}
                placeholder={t.note}
                onChange={(e) => { setNote(e.target.value); setNoteSaved(false); }}
                data-testid="award-note"
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className={secondaryBtn}
                  disabled={busy}
                  onClick={async () => setNoteSaved(await write("/api/admin/game/award", "PATCH", { week: board.week, note }))}
                  data-testid="award-note-save"
                >
                  {t.noteSave}
                </button>
                {noteSaved ? <span role="status" className="text-sm text-muted">{t.noteSaved}</span> : null}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-muted" data-testid="winner-none">{t.winnerNone}</p>
        )}
      </AdminCard>

      <AdminCard>
        {board.rows.length === 0 ? (
          <p className="text-muted" data-testid="board-empty">{t.noRuns}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {board.rows.slice(0, shown).map((r) => (
              <li key={r.id} className={`py-3 ${r.hidden || r.banned ? "opacity-60" : ""}`} data-testid="run-row">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="min-w-0 break-all">
                    <span className="text-muted">{r.rank ?? "–"}</span>{" "}
                    <span className="font-semibold">{r.nickname}</span>{" "}
                    <span className="text-muted" data-testid="run-wechat">{r.wechatId}</span>
                  </div>
                  <span className="text-lg font-semibold" data-testid="run-score">{r.score}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted">
                  <span>{timeLabel(r.finishedAt ?? r.updatedAt ?? "")}</span>
                  <span className={chip}>{r.verified ? t.verified : t.unverified}</span>
                  {r.dropCount !== null && r.durationSec !== null ? (
                    <span data-testid="run-evidence">
                      {fill(game === "m3" ? t.moves : t.drops, { n: r.dropCount })} · {fill(t.duration, { s: r.durationSec })}
                    </span>
                  ) : null}
                  <span className={chip} data-testid="run-ordered">{r.ordered ? t.ordered : t.notOrdered}</span>
                  {r.suspicious ? <span className={`${chip} text-danger`} data-testid="run-suspicious">{t.suspicious}</span> : null}
                  {r.hidden ? <span className={chip}>{t.hidden}</span> : null}
                  {r.banned ? <span className={`${chip} text-danger`}>{t.banned}</span> : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={secondaryBtn}
                    disabled={busy}
                    onClick={() => void write(`/api/admin/game/runs/${r.id}`, "PATCH", { hidden: !r.hidden })}
                    data-testid={r.hidden ? "run-unhide" : "run-hide"}
                  >
                    {r.hidden ? t.unhide : t.hide}
                  </button>
                  {r.banned ? (
                    <button
                      type="button"
                      className={secondaryBtn}
                      disabled={busy}
                      onClick={() => void write(`/api/admin/game/bans/${encodeURIComponent(r.wechatId)}`, "DELETE")}
                    >
                      {t.unban}
                    </button>
                  ) : (
                    <button type="button" className={dangerBtn} disabled={busy} onClick={() => { setBanFor(r.wechatId); setReason(""); }} data-testid="run-ban">
                      {t.ban}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {board.rows.length > shown ? (
          <button type="button" className={`${secondaryBtn} mt-2 w-full`} onClick={() => setShown((n) => n + PAGE)}>
            {t.loadMore}
          </button>
        ) : null}
      </AdminCard>

      <AdminCard title={t.bansTitle}>
        {board.bans.length === 0 ? (
          <p className="text-muted" data-testid="bans-empty">{t.bansEmpty}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line" data-testid="bans-list">
            {board.bans.map((b) => (
              <li key={b.wechatId} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0 break-all">
                  <div className="font-medium">{b.wechatId}</div>
                  {b.reason ? <div className="text-sm text-muted">{b.reason}</div> : null}
                </div>
                <button
                  type="button"
                  className={secondaryBtn}
                  disabled={busy}
                  onClick={() => void write(`/api/admin/game/bans/${encodeURIComponent(b.wechatId)}`, "DELETE")}
                  data-testid="ban-remove"
                >
                  {t.unban}
                </button>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>

      {banFor ? (
        <Sheet title={fill(t.banConfirm, { id: banFor })} onClose={() => setBanFor(null)} busy={busy}>
          <input className={`${inputClass} mb-3`} value={reason} maxLength={200} placeholder={t.banReason} aria-label={t.banReason} onChange={(e) => setReason(e.target.value)} data-testid="ban-reason" />
          <div className="flex gap-2">
            <button
              type="button"
              className={`${dangerBtn} flex-1`}
              disabled={busy}
              onClick={async () => {
                if (await write("/api/admin/game/bans", "POST", { wechatId: banFor, reason: reason || undefined })) setBanFor(null);
              }}
              data-testid="ban-submit"
            >
              {t.banSubmit}
            </button>
            <button type="button" className={primaryBtn} onClick={() => setBanFor(null)} disabled={busy}>
              {t.cancel}
            </button>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}

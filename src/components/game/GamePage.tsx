"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { RollNumber } from "@/components/customer/checkout/RollNumber";
import { fill } from "@/components/customer/format";
import { Sheet, type SheetHandle } from "@/components/ui/Sheet";
import { TopBar } from "@/components/ui/TopBar";
import { focusRing } from "@/components/ui/focus";
import { copy } from "@/copy";
import { fetchMenu } from "@/lib/api";
import { useMotionPrefs } from "@/lib/motion/react";
import { Board, type HudState } from "./Board";
import { LeaderboardView } from "./LeaderboardView";
import { PieceChip } from "./PieceChip";
import { Session } from "./engine";
import { finishRun, isRetryable, readRemembered, startRun, writeRemembered } from "./gameApi";
import { clearSave, readSave, writeSave, type GameSave } from "./save";
import { sound, unlockAudio } from "./sound";
import type { FinishResult } from "./types";
import "./game.css";

const t = copy.customer.game;
const SHEET_DELAY_MS = 800;

type Phase = "menu" | "form" | "playing" | "over" | "board";
type Finish =
  | { state: "submitting" }
  | { state: "ok"; result: FinishResult }
  | { state: "failed"; message: string; retry: boolean };

const points = (s: string) => [...s].length;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

function validate(wechatId: string, nickname: string) {
  const w = wechatId.trim();
  const n = nickname.trim();
  return {
    wechat: points(w) >= 1 && points(w) <= 40 ? null : t.wechatInvalid,
    nick: points(n) >= 1 && points(n) <= 10 && !CONTROL.test(n) ? null : t.nicknameInvalid,
  };
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col bg-c-wash text-c-ink">
      <div className="mx-auto flex w-full max-w-[430px] flex-1 flex-col overflow-x-clip bg-c-paper">{children}</div>
    </div>
  );
}

function SpeakerButton({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      aria-label={on ? t.soundOff : t.soundOn}
      className={`grid size-11 shrink-0 place-items-center rounded-full text-c-ink ${focusRing}`}
      data-testid="game-sound"
    >
      <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" />
        {on ? <path d="M15.5 9a4 4 0 010 6M18 6.5a8 8 0 010 11" /> : <path d="M16 9.5l5 5M21 9.5l-5 5" />}
      </svg>
    </button>
  );
}

export function GamePage() {
  const { reduced } = useMotionPrefs();
  const [phase, setPhase] = useState<Phase>("menu");
  const [wechatId, setWechatId] = useState("");
  const [nickname, setNickname] = useState("");
  const [soundOn, setSoundOn] = useState(false);
  const [errors, setErrors] = useState<{ wechat: string | null; nick: string | null }>({ wechat: null, nick: null });
  const [formError, setFormError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [owner, setOwner] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const runId = useRef("");
  const sessionRef = useRef<Session | null>(null);
  const [runKey, setRunKey] = useState("");
  const [hud, setHud] = useState<HudState>({ score: 0, next: 0 });
  const [finish, setFinish] = useState<Finish>({ state: "submitting" });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [boardVersion, setBoardVersion] = useState(0);
  /** Where 返回 on the leaderboard goes: the finished run it was opened from, or the menu. */
  const [boardFrom, setBoardFrom] = useState<"menu" | "over">("menu");
  /** The saved run on this phone (D111), shown on the menu. */
  const [save, setSave] = useState<GameSave | null>(null);
  const [dialog, setDialog] = useState<"restart" | "exit" | null>(null);
  const dialogRef = useRef<SheetHandle>(null);
  const afterDialog = useRef<() => void>(() => {});
  /** What the autosave needs besides the session. */
  const meta = useRef({ seed: "", expiresAt: "", nickname: "" });
  /** Runs whose finish was already sent (at most one automatic submit per run) and the one in flight. */
  const submitted = useRef(new Set<string>());
  const inflight = useRef<string | null>(null);
  const sheetRef = useRef<SheetHandle>(null);
  const afterSheet = useRef<() => void>(() => {});
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const r = readRemembered();
    /* Reading the browser-only store once on mount. */
    /* eslint-disable react-hooks/set-state-in-effect */
    setWechatId(r.wechatId);
    setNickname(r.nickname);
    setSoundOn(r.sound);
    setSave(readSave());
    /* eslint-enable react-hooks/set-state-in-effect */
    let alive = true;
    fetchMenu().then((m) => {
      if (alive && m.ok) setOwner(m.data.ownerWechatId ?? null);
    });
    const pending = timers.current;
    return () => {
      alive = false;
      pending.forEach(clearTimeout);
    };
  }, []);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    writeRemembered({ sound: next });
    if (next) {
      unlockAudio();
      sound.drop();
    }
  };

  const submit = useCallback(async (s: Session, id: string, retry = false) => {
    if (!retry && submitted.current.has(id)) return;
    if (inflight.current === id) return;
    submitted.current.add(id);
    inflight.current = id;
    setFinish({ state: "submitting" });
    const r = await finishRun(id, s.drops);
    if (inflight.current === id) inflight.current = null;
    // A late answer of an earlier run must not show on the current one.
    if (runId.current !== id) return;
    if (r.ok) {
      setFinish({ state: "ok", result: r.data });
      setBoardVersion((n) => n + 1);
    } else {
      setFinish({ state: "failed", message: r.error.message, retry: isRetryable(r.status) });
    }
  }, []);

  const persist = useCallback(() => {
    const s = sessionRef.current;
    if (!s || s.over || s.drops.length === 0) return;
    const m = meta.current;
    writeSave({ v: 1, runId: runId.current, seed: m.seed, tiers: s.tiers, drops: s.drops, nickname: m.nickname, expiresAt: m.expiresAt, score: s.score });
  }, []);

  const toMenu = () => {
    sessionRef.current = null;
    setSession(null);
    setSheetOpen(false);
    setSave(readSave());
    setPhase("menu");
  };

  const resume = () => {
    const sv = readSave();
    const s = sv ? Session.restore(sv.tiers, sv.seed, sv.drops) : null;
    if (!sv || !s) {
      clearSave();
      setSave(null);
      return;
    }
    if (soundOn) unlockAudio();
    runId.current = sv.runId;
    inflight.current = null;
    meta.current = { seed: sv.seed, expiresAt: sv.expiresAt, nickname: sv.nickname };
    sessionRef.current = s;
    setSession(s);
    setRunKey(sv.runId);
    setHud({ score: s.score, next: s.upcoming() });
    setSheetOpen(false);
    setPhase("playing");
  };

  const closeDialogThen = (fn: () => void) => {
    afterDialog.current = fn;
    dialogRef.current?.close();
  };

  const begin = async (e?: FormEvent) => {
    e?.preventDefault();
    if (starting) return;
    const v = validate(wechatId, nickname);
    setErrors(v);
    setFormError(null);
    if (v.wechat || v.nick) {
      setPhase("form");
      return;
    }
    setStarting(true);
    if (soundOn) unlockAudio();
    const w = wechatId.trim();
    const n = nickname.trim();
    const r = await startRun(w, n);
    setStarting(false);
    if (!r.ok || !Array.isArray(r.data.tiers) || r.data.tiers.length < 3) {
      setFormError(r.ok ? t.startFailed : r.error.message);
      setSheetOpen(false);
      setPhase("form");
      return;
    }
    writeRemembered({ wechatId: w, nickname: n });
    clearSave();
    meta.current = { seed: r.data.seed, expiresAt: r.data.expiresAt, nickname: n };
    runId.current = r.data.runId;
    inflight.current = null;
    setHud({ score: 0, next: 0 });
    const next = new Session(r.data.tiers, r.data.seed);
    sessionRef.current = next;
    setSession(next);
    setRunKey(r.data.runId);
    setSheetOpen(false);
    setPhase("playing");
  };

  const onOver = useCallback(() => {
    clearSave();
    setPhase("over");
    if (sessionRef.current && !submitted.current.has(runId.current)) void submit(sessionRef.current, runId.current);
    timers.current.push(setTimeout(() => setSheetOpen(true), reduced ? 0 : SHEET_DELAY_MS));
  }, [reduced, submit]);

  const closeSheetThen = (fn: () => void) => {
    afterSheet.current = fn;
    sheetRef.current?.close();
  };

  const exitButton =
    phase === "playing" ? (
      <button
        type="button"
        onClick={() => setDialog("exit")}
        className={`min-h-11 shrink-0 rounded-full px-3 text-sm font-bold text-c-ink ${focusRing}`}
        data-testid="game-exit"
      >
        {t.exit}
      </button>
    ) : null;

  const top = (
    <TopBar
      backHref="/"
      backLabel={t.backLabel}
      title={t.pageTitle}
      titleAs="h1"
      right={
        <div className="flex items-center">
          {exitButton}
          <SpeakerButton on={soundOn} onToggle={toggleSound} />
        </div>
      }
    />
  );

  // ---------------- leaderboard ----------------
  if (phase === "board") {
    return (
      <Shell>
        {top}
        <main className="flex-1 pb-[calc(24px+env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between px-5 pt-2 pb-1">
            <h2 className="font-display m-0 text-[26px] leading-none tracking-[-0.03em]">{t.boardTitle}</h2>
            <button
              type="button"
              onClick={() => {
                if (boardFrom === "over" && session?.over) {
                  setPhase("over");
                  setSheetOpen(true);
                } else setPhase("menu");
              }}
              className={`min-h-11 rounded-full bg-c-wash px-5 text-sm font-bold ${focusRing}`}
              data-testid="game-board-close"
            >
              {t.closeBoard}
            </button>
          </div>
          <LeaderboardView wechatId={wechatId.trim()} version={boardVersion} />
        </main>
      </Shell>
    );
  }

  // ---------------- menu (D110) ----------------
  if (phase === "menu") {
    const rules = [t.rules, owner ? fill(t.rulesContact, { id: owner }) : ""].join("");
    const secondary = `min-h-11 w-full rounded-full bg-c-wash text-[15px] font-bold ${focusRing}`;
    return (
      <Shell>
        {top}
        <main className="flex flex-1 flex-col px-5 pb-[calc(24px+env(safe-area-inset-bottom))]">
          <h2 className="font-display m-0 mt-2 text-[34px] leading-[1.1] tracking-[-0.04em]">{t.startTitle}</h2>
          <p className="m-0 mt-2 text-sm leading-relaxed text-c-grey">{t.startHint}</p>
          <p className="font-display m-0 mt-6 text-center text-[15px] leading-snug text-c-ink" data-testid="game-prize-line">
            {t.prizeLine}
          </p>
          <div className="mt-4 flex flex-col gap-3">
            {save ? (
              <>
                <button
                  type="button"
                  onClick={resume}
                  className={`font-display h-[72px] w-full rounded-full bg-c-ink text-lg text-c-paper ${focusRing}`}
                  data-testid="game-resume"
                >
                  {t.resume}
                  <span className="font-num mt-0.5 block text-xs font-normal opacity-70" data-testid="game-resume-score">
                    {fill(t.lastScore, { score: String(save.score) })}
                  </span>
                </button>
                <button type="button" onClick={() => setDialog("restart")} className={secondary} data-testid="game-restart">
                  {t.restart}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setFormError(null);
                  setPhase("form");
                }}
                className={`font-display h-14 w-full rounded-full bg-c-ink text-lg text-c-paper ${focusRing}`}
                data-testid="game-menu-start"
              >
                {t.start}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setBoardFrom("menu");
                setPhase("board");
              }}
              className={secondary}
              data-testid="game-open-board"
            >
              {t.viewBoard}
            </button>
          </div>
          <p className="mt-auto pt-8 text-[13px] leading-[1.7] text-c-grey" data-testid="game-rules">
            {rules}
          </p>
        </main>
        {dialog === "restart" ? (
          <Sheet
            ref={dialogRef}
            label={t.restartTitle}
            onClosed={() => {
              setDialog(null);
              const fn = afterDialog.current;
              afterDialog.current = () => {};
              fn();
            }}
            className="px-6 pt-7 pb-[calc(24px+env(safe-area-inset-bottom))]"
            panelTestId="game-restart-sheet"
          >
            <p className="font-display m-0 text-center text-xl leading-snug">{t.restartTitle}</p>
            <div className="mt-6 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() =>
                  closeDialogThen(() => {
                    clearSave();
                    setSave(null);
                    setFormError(null);
                    setPhase("form");
                  })
                }
                className={`font-display h-14 w-full rounded-full bg-c-ink text-lg text-c-paper ${focusRing}`}
                data-testid="game-restart-confirm"
              >
                {t.restartConfirm}
              </button>
              <button type="button" onClick={() => closeDialogThen(() => {})} className={secondary} data-testid="game-restart-cancel">
                {t.keepPlaying}
              </button>
            </div>
          </Sheet>
        ) : null}
      </Shell>
    );
  }

  // ---------------- form ----------------
  if (phase === "form" || !session) {
    const input =
      "h-12 w-full rounded-2xl border border-c-line bg-c-paper px-4 text-base text-c-ink placeholder:text-c-grey-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-c-ink";
    return (
      <Shell>
        {top}
        <main className="flex flex-1 flex-col px-5 pb-[calc(24px+env(safe-area-inset-bottom))]">
          <h2 className="font-display m-0 mt-2 text-[34px] leading-[1.1] tracking-[-0.04em]">{t.startTitle}</h2>
          <form onSubmit={begin} noValidate className="mt-6 flex flex-col gap-4" data-testid="game-form">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-bold">{t.wechatLabel}</span>
              <input
                value={wechatId}
                onChange={(e) => setWechatId(e.target.value)}
                placeholder={t.wechatPlaceholder}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={errors.wechat ? true : undefined}
                aria-describedby={errors.wechat ? "game-wechat-err" : undefined}
                className={input}
                data-testid="game-wechat"
              />
              {errors.wechat ? (
                <span id="game-wechat-err" role="alert" className="mt-1 block text-[13px] text-c-red">
                  {errors.wechat}
                </span>
              ) : null}
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-bold">{t.nicknameLabel}</span>
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder={t.nicknamePlaceholder}
                autoComplete="off"
                aria-invalid={errors.nick ? true : undefined}
                aria-describedby={errors.nick ? "game-nick-err" : undefined}
                className={input}
                data-testid="game-nickname"
              />
              {errors.nick ? (
                <span id="game-nick-err" role="alert" className="mt-1 block text-[13px] text-c-red">
                  {errors.nick}
                </span>
              ) : null}
            </label>
            {formError ? (
              <p role="alert" className="m-0 text-sm text-c-red" data-testid="game-form-error">
                {formError}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={starting}
              className={`font-display mt-1 h-14 w-full rounded-full bg-c-ink text-lg text-c-paper disabled:opacity-60 ${focusRing}`}
              data-testid="game-start"
            >
              {starting ? t.starting : t.start}
            </button>
            <button
              type="button"
              onClick={() => setPhase("menu")}
              className={`min-h-11 w-full rounded-full bg-c-wash text-[15px] font-bold ${focusRing}`}
              data-testid="game-form-back"
            >
              {t.closeBoard}
            </button>
          </form>
        </main>
      </Shell>
    );
  }

  // ---------------- playing / over ----------------
  const next = session.tiers[Math.min(hud.next, session.tiers.length - 1)];
  // What the server recorded is what counts; the client's own number is only shown until then.
  const finalScore = finish.state === "ok" ? finish.result.score : session.score;
  const sameScore = finish.state === "ok" && finish.result.score === session.score;
  return (
    <Shell>
      {top}
      <main className="relative flex flex-1 flex-col items-stretch px-2 pb-[calc(12px+env(safe-area-inset-bottom))]">
        <div className="flex h-[92px] shrink-0 items-center justify-between px-2" data-testid="game-hud">
          <div>
            <p className="m-0 text-xs font-bold text-c-grey">{t.score}</p>
            <p className="font-num m-0 text-[40px] leading-[1.15] text-c-ink" aria-live="off">
              <RollNumber value={String(hud.score)} testId="game-score" />
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="text-xs font-bold text-c-grey">{t.next}</span>
            <PieceChip tier={next} size={44} />
          </div>
        </div>
        {/* On tall phones the board sits in the middle of the space under the HUD. */}
        <div className="flex flex-1 items-center justify-center">
          <Board
            key={runKey}
            session={session}
            soundOn={soundOn}
            reduced={reduced}
            onHud={setHud}
            onOver={onOver}
            onDrop={persist}
          />
        </div>
          {phase === "over" && !sheetOpen ? (
            <div className="absolute inset-x-2 bottom-[calc(12px+env(safe-area-inset-bottom))] z-10 flex h-12 items-stretch overflow-hidden rounded-full border border-c-line bg-c-paper/90 text-c-ink backdrop-blur-sm" data-testid="game-bar">
              <button
                type="button"
                onClick={() => void begin()}
                disabled={finish.state === "submitting"}
                className={`font-display flex-1 text-base disabled:opacity-50 ${focusRing}`}
                data-testid="game-bar-again"
              >
                {t.barAgain}
              </button>
              <span aria-hidden="true" className="self-center opacity-50">
                ·
              </span>
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                className={`font-display flex-1 text-base ${focusRing}`}
                data-testid="game-bar-score"
              >
                {t.barScore}
              </button>
            </div>
          ) : null}
      </main>

      {dialog === "exit" ? (
        <Sheet
          ref={dialogRef}
          label={t.exitTitle}
          onClosed={() => {
            setDialog(null);
            const fn = afterDialog.current;
            afterDialog.current = () => {};
            fn();
          }}
          className="px-6 pt-7 pb-[calc(24px+env(safe-area-inset-bottom))]"
          panelTestId="game-exit-sheet"
        >
          <p className="font-display m-0 text-center text-xl leading-snug">{t.exitTitle}</p>
          <div className="mt-6 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={() =>
                closeDialogThen(() => {
                  persist();
                  toMenu();
                })
              }
              className={`font-display h-14 w-full rounded-full bg-c-ink text-lg text-c-paper ${focusRing}`}
              data-testid="game-exit-save"
            >
              {t.exitSave}
            </button>
            <button
              type="button"
              onClick={() =>
                closeDialogThen(() => {
                  clearSave();
                  toMenu();
                })
              }
              className={`min-h-11 w-full rounded-full bg-c-wash text-[15px] font-bold ${focusRing}`}
              data-testid="game-exit-discard"
            >
              {t.exitDiscard}
            </button>
          </div>
        </Sheet>
      ) : null}

      {phase === "over" && sheetOpen ? (
        <Sheet
          ref={sheetRef}
          label={t.overTitle}
          onClosed={() => {
            setSheetOpen(false);
            const fn = afterSheet.current;
            afterSheet.current = () => {};
            fn();
          }}
          className="px-6 pt-7 pb-[calc(24px+env(safe-area-inset-bottom))]"
          panelTestId="game-over-sheet"
        >
          <button
            type="button"
            onClick={() => sheetRef.current?.close()}
            aria-label={t.close}
            className={`absolute top-2 right-2 grid size-11 place-items-center rounded-full text-c-ink ${focusRing}`}
            data-testid="game-over-close"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          <h2 className="font-display m-0 text-center text-[28px] leading-none tracking-[-0.03em]">{t.overTitle}</h2>
          <p className="m-0 mt-5 text-center text-xs font-bold text-c-grey">{t.finalScore}</p>
          <p className="font-num m-0 text-center text-[56px] leading-[1.1]" data-testid="game-final-score">
            {finalScore}
          </p>
          <div className="mt-2 min-h-[72px] text-center" aria-live="polite" data-testid="game-finish">
            {finish.state === "submitting" ? (
              <p className="m-0 text-sm text-c-grey">{t.submitting}</p>
            ) : finish.state === "failed" ? (
              <>
                <p className="m-0 text-sm text-c-red" role="alert">
                  {t.submitFailed}
                </p>
                {finish.retry ? (
                  <button
                    type="button"
                    onClick={() => void submit(session, runId.current, true)}
                    className={`mt-2 min-h-11 rounded-full bg-c-wash px-6 text-sm font-bold ${focusRing}`}
                    data-testid="game-retry"
                  >
                    {t.retry}
                  </button>
                ) : (
                  <p className="m-0 mt-1 text-[13px] text-c-grey">{finish.message}</p>
                )}
              </>
            ) : (
              <div className="flex items-start justify-center gap-8">
                {sameScore ? (
                  <p className="m-0 text-sm font-bold" data-testid="game-confirmed">
                    {t.confirmed}
                    {finish.result.rank != null ? (
                      <span className="mt-0.5 block text-base">
                        {t.rankPre} <b className="font-num text-xl font-normal">{finish.result.rank}</b> {t.rankPost}
                      </span>
                    ) : null}
                  </p>
                ) : (
                  <p className="m-0 text-sm text-c-grey" data-testid="game-differs">
                    {t.scoreDiffers}
                  </p>
                )}
                <p className="m-0 text-sm font-bold">
                  {t.best}
                  <span className="font-num mt-0.5 block text-xl font-normal" data-testid="game-best">
                    {finish.result.best}
                  </span>
                </p>
              </div>
            )}
          </div>
          {finish.state === "ok" && typeof finish.result.personalBest === "number" ? (
            <div className="mt-1 text-center">
              {finish.result.newRecord ? (
                <p
                  className={`font-display m-0 mb-1 text-xl ${reduced ? "" : "game-record-pop"}`}
                  data-testid="game-new-record"
                >
                  {t.newRecord}
                </p>
              ) : null}
              <p className="m-0 text-sm font-bold">
                {t.personalBest} <span className="font-num text-xl font-normal" data-testid="game-personal-best">{finish.result.personalBest}</span>
              </p>
            </div>
          ) : null}
          <div className="mt-4 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={() => closeSheetThen(() => void begin())}
              className={`font-display h-14 w-full rounded-full bg-c-ink text-lg text-c-paper disabled:opacity-50 ${focusRing}`}
              disabled={finish.state === "submitting"}
              data-testid="game-again"
            >
              {finish.state === "failed" ? t.againDiscard : t.again}
            </button>
            <button
              type="button"
              onClick={() => closeSheetThen(() => {
                  setBoardFrom("over");
                  setPhase("board");
                })}
              className={`min-h-11 w-full rounded-full bg-c-wash text-[15px] font-bold ${focusRing}`}
              data-testid="game-to-board"
            >
              {t.toBoard}
            </button>
          </div>
        </Sheet>
      ) : null}
    </Shell>
  );
}

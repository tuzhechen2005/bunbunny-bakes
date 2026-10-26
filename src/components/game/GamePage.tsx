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
import { sound, unlockAudio } from "./sound";
import type { FinishResult } from "./types";
import "./game.css";

const t = copy.customer.game;
const SHEET_DELAY_MS = 800;

type Phase = "start" | "playing" | "over" | "board";
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
  const [phase, setPhase] = useState<Phase>("start");
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
  /** Where 返回 on the leaderboard goes: the finished run it was opened from, or the start screen. */
  const [boardFrom, setBoardFrom] = useState<"start" | "over">("start");
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

  const begin = async (e?: FormEvent) => {
    e?.preventDefault();
    if (starting) return;
    const v = validate(wechatId, nickname);
    setErrors(v);
    setFormError(null);
    if (v.wechat || v.nick) return;
    setStarting(true);
    if (soundOn) unlockAudio();
    const w = wechatId.trim();
    const n = nickname.trim();
    const r = await startRun(w, n);
    setStarting(false);
    if (!r.ok || !Array.isArray(r.data.tiers) || r.data.tiers.length < 3) {
      setFormError(r.ok ? t.startFailed : r.error.message);
      setSheetOpen(false);
      setPhase("start");
      return;
    }
    writeRemembered({ wechatId: w, nickname: n });
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
    setPhase("over");
    if (sessionRef.current && !submitted.current.has(runId.current)) void submit(sessionRef.current, runId.current);
    timers.current.push(setTimeout(() => setSheetOpen(true), reduced ? 0 : SHEET_DELAY_MS));
  }, [reduced, submit]);

  const closeSheetThen = (fn: () => void) => {
    afterSheet.current = fn;
    sheetRef.current?.close();
  };

  const top = (
    <TopBar
      backHref="/"
      backLabel={t.backLabel}
      title={t.pageTitle}
      titleAs="h1"
      right={<SpeakerButton on={soundOn} onToggle={toggleSound} />}
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
                } else setPhase("start");
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

  // ---------------- start ----------------
  if (phase === "start" || !session) {
    const rules = [t.rules, owner ? fill(t.rulesContact, { id: owner }) : ""].join("");
    const input =
      "h-12 w-full rounded-2xl border border-c-line bg-c-paper px-4 text-base text-c-ink placeholder:text-c-grey-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-c-ink";
    return (
      <Shell>
        {top}
        <main className="flex flex-1 flex-col px-5 pb-[calc(24px+env(safe-area-inset-bottom))]">
          <h2 className="font-display m-0 mt-2 text-[34px] leading-[1.1] tracking-[-0.04em]">{t.startTitle}</h2>
          <p className="m-0 mt-2 text-sm leading-relaxed text-c-grey">{t.startHint}</p>
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
            <p className="font-display m-0 mt-1 text-center text-[15px] leading-snug text-c-ink" data-testid="game-prize-line">
              {t.prizeLine}
            </p>
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
              onClick={() => {
                setBoardFrom("start");
                setPhase("board");
              }}
              className={`min-h-11 w-full rounded-full bg-c-wash text-[15px] font-bold ${focusRing}`}
              data-testid="game-open-board"
            >
              {t.viewBoard}
            </button>
          </form>
          <p className="mt-auto pt-8 text-[13px] leading-[1.7] text-c-grey" data-testid="game-rules">
            {rules}
          </p>
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
      <main className="flex flex-1 flex-col items-stretch px-2 pb-[calc(12px+env(safe-area-inset-bottom))]">
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
          />
        </div>
      </main>

      {phase === "over" && sheetOpen ? (
        <Sheet
          ref={sheetRef}
          label={t.overTitle}
          dismissible={false}
          onClosed={() => {
            setSheetOpen(false);
            afterSheet.current();
          }}
          className="px-6 pt-7 pb-[calc(24px+env(safe-area-inset-bottom))]"
          panelTestId="game-over-sheet"
        >
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

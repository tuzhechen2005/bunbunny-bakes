"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { fill } from "@/components/customer/format";
import { LeaderboardView } from "@/components/game/LeaderboardView";
import { isRetryable, readRemembered, writeRemembered } from "@/components/game/gameApi";
import { sound, unlockAudio } from "@/components/game/sound";
import type { FinishResult, TierView } from "@/components/game/types";
import { Sheet, type SheetHandle } from "@/components/ui/Sheet";
import { TopBar } from "@/components/ui/TopBar";
import { focusRing } from "@/components/ui/focus";
import { useGameHub } from "@/components/game/useGameHub";
import { useLiveProgress } from "@/components/game/useLiveProgress";
import { copy } from "@/copy";
import type { M3Move } from "@/lib/m3";
import { fetchMenu } from "@/lib/api";
import { useMotionPrefs } from "@/lib/motion/react";
import { M3Board, type M3Progress } from "./M3Board";
import { SpecialMark } from "./M3Art";
import { fetchM3Leaderboard, finishM3, startM3 } from "./m3Api";
import { clearM3Save, readM3Save, writeM3Save, type M3Save } from "./m3Save";

const g = copy.customer.game;
const t = copy.customer.m3;
const SHEET_DELAY_MS = 900;

type Phase = "menu" | "form" | "playing" | "over" | "board";
type Finish =
  | { state: "submitting" }
  | { state: "ok"; result: FinishResult }
  | { state: "failed"; message: string; retry: boolean };
interface Run {
  key: string;
  seed: string;
  tiers: TierView[];
  initialMoves: M3Move[];
}

const points = (s: string) => [...s].length;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

function validate(wechatId: string, nickname: string) {
  const w = wechatId.trim();
  const n = nickname.trim();
  return {
    wechat: points(w) >= 1 && points(w) <= 40 ? null : g.wechatInvalid,
    nick: points(n) >= 1 && points(n) <= 10 && !CONTROL.test(n) ? null : g.nicknameInvalid,
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
      aria-label={on ? g.soundOff : g.soundOn}
      className={`grid size-11 shrink-0 place-items-center rounded-full text-c-ink ${focusRing}`}
      data-testid="m3-sound"
    >
      <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" />
        {on ? <path d="M15.5 9a4 4 0 010 6M18 6.5a8 8 0 010 11" /> : <path d="M16 9.5l5 5M21 9.5l-5 5" />}
      </svg>
    </button>
  );
}

export function M3Page() {
  const { reduced, degraded } = useMotionPrefs();
  const { data: hub } = useGameHub();
  const hasPrize = hub?.prizeGame === "M3";
  const [phase, setPhase] = useState<Phase>("menu");
  const [wechatId, setWechatId] = useState("");
  const [nickname, setNickname] = useState("");
  const [soundOn, setSoundOn] = useState(false);
  const [errors, setErrors] = useState<{ wechat: string | null; nick: string | null }>({ wechat: null, nick: null });
  const [formError, setFormError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [owner, setOwner] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const runId = useRef("");
  const progress = useRef<M3Progress>({ moves: [], score: 0 });
  const [finish, setFinish] = useState<Finish>({ state: "submitting" });
  const [finalScore, setFinalScore] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [boardVersion, setBoardVersion] = useState(0);
  const [boardFrom, setBoardFrom] = useState<"menu" | "over">("menu");
  const [save, setSave] = useState<M3Save | null>(null);
  const [dialog, setDialog] = useState<"restart" | "exit" | null>(null);
  const dialogRef = useRef<SheetHandle>(null);
  const afterDialog = useRef<() => void>(() => {});
  const meta = useRef({ seed: "", expiresAt: "", nickname: "", tiers: [] as TierView[] });
  const submitted = useRef(new Set<string>());
  const inflight = useRef<string | null>(null);
  const sheetRef = useRef<SheetHandle>(null);
  const afterSheet = useRef<() => void>(() => {});
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const phaseRef = useRef<Phase>("menu");
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    const r = readRemembered();
    /* Reading the browser-only store once on mount. */
    /* eslint-disable react-hooks/set-state-in-effect */
    setWechatId(r.wechatId);
    setNickname(r.nickname);
    setSoundOn(r.sound);
    setSave(readM3Save());
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

  const submit = useCallback(async (id: string, moves: M3Move[], retry = false) => {
    if (!retry && submitted.current.has(id)) return;
    if (inflight.current === id) return;
    submitted.current.add(id);
    inflight.current = id;
    setFinish({ state: "submitting" });
    const r = await finishM3(id, moves);
    if (inflight.current === id) inflight.current = null;
    if (runId.current !== id) return;
    if (r.ok) {
      // Keep completed logs retryable until the server acknowledges this exact run.
      if (readM3Save()?.runId === id) clearM3Save();
      setFinish({ state: "ok", result: r.data });
      setBoardVersion((n) => n + 1);
    } else {
      setFinish({ state: "failed", message: r.error.message, retry: isRetryable(r.status) });
    }
  }, []);

  const persist = useCallback(() => {
    const p = progress.current;
    if (phaseRef.current !== "playing") return;
    const m = meta.current;
    writeM3Save({ v: 1, runId: runId.current, seed: m.seed, tiers: m.tiers, moves: p.moves, nickname: m.nickname, expiresAt: m.expiresAt, score: p.score });
  }, []);
  const onProgress = useCallback(
    (p: M3Progress) => {
      progress.current = p;
      persist();
    },
    [persist],
  );

  const readProgress = useCallback(() => runId.current && !submitted.current.has(runId.current)
    ? { runId: runId.current, log: progress.current.moves } : null, []);
  useLiveProgress("/api/game/m3/progress", phase === "playing", readProgress);

  const toMenu = () => {
    setRun(null);
    setSheetOpen(false);
    setSave(readM3Save());
    setPhase("menu");
  };

  const resume = () => {
    const sv = readM3Save();
    if (!sv) {
      clearM3Save();
      setSave(null);
      return;
    }
    if (soundOn) unlockAudio();
    runId.current = sv.runId;
    inflight.current = null;
    meta.current = { seed: sv.seed, expiresAt: sv.expiresAt, nickname: sv.nickname, tiers: sv.tiers };
    progress.current = { moves: sv.moves, score: sv.score };
    setRun({ key: sv.runId, seed: sv.seed, tiers: sv.tiers, initialMoves: sv.moves });
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
    const r = await startM3(w, n);
    setStarting(false);
    if (!r.ok || !Array.isArray(r.data.tiers) || r.data.tiers.length !== 6) {
      setFormError(r.ok || r.error.error.toLowerCase() === "unavailable" ? t.unavailable : r.error.message);
      setSheetOpen(false);
      setPhase("form");
      return;
    }
    writeRemembered({ wechatId: w, nickname: n });
    clearM3Save();
    meta.current = { seed: r.data.seed, expiresAt: r.data.expiresAt, nickname: r.data.nickname ?? n, tiers: r.data.tiers };
    runId.current = r.data.runId;
    inflight.current = null;
    progress.current = { moves: [], score: 0 };
    writeM3Save({ v: 1, runId: r.data.runId, seed: r.data.seed, tiers: r.data.tiers, moves: [], nickname: r.data.nickname ?? n, expiresAt: r.data.expiresAt, score: 0 });
    setFinish({ state: "submitting" });
    setRun({ key: r.data.runId, seed: r.data.seed, tiers: r.data.tiers, initialMoves: [] });
    setSheetOpen(false);
    setPhase("playing");
  };

  const onOver = useCallback(
    (p: M3Progress) => {
      if (submitted.current.has(runId.current)) return;
      // Unmount Exit (releasing its focus trap/scroll lock) before showing results.
      // Its closing animation may still resolve: discard any queued menu/discard action.
      afterDialog.current = () => {};
      setDialog(null);
      phaseRef.current = "over";
      progress.current = p;
      setFinalScore(p.score);
      setRun(r => r ? { ...r, initialMoves: p.moves } : r);
      setPhase("over");
      const id = runId.current;
      void submit(id, p.moves);
      timers.current.push(setTimeout(() => {
        if (runId.current === id && phaseRef.current === "over") setSheetOpen(true);
      }, reduced ? 0 : SHEET_DELAY_MS));
    },
    [reduced, submit],
  );

  const closeSheetThen = (fn: () => void) => {
    afterSheet.current = fn;
    sheetRef.current?.close();
  };

  const top = (
    <TopBar
      backHref="/game/hub"
      backLabel={copy.customer.gameHub.backLabel}
      title={phase === "board" ? t.pageTitle : undefined}
      titleAs="p"
      right={
        <div className="flex items-center">
          {phase === "playing" ? (
            <button type="button" onClick={() => setDialog("exit")} className={`min-h-11 shrink-0 rounded-full px-3 text-sm font-bold text-c-ink ${focusRing}`} data-testid="m3-exit">
              {g.exit}
            </button>
          ) : null}
          <SpeakerButton on={soundOn} onToggle={toggleSound} />
        </div>
      }
    />
  );

  const primary = `font-display h-14 w-full rounded-full bg-c-ink text-lg text-c-paper ${focusRing}`;
  const secondary = `min-h-11 w-full rounded-full bg-c-wash text-[15px] font-bold ${focusRing}`;

  // ---------------- leaderboard ----------------
  if (phase === "board") {
    return (
      <Shell>
        {top}
        <main className="flex-1 pb-[calc(24px+env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between px-5 pt-2 pb-1">
            <h2 className="font-display m-0 text-[26px] leading-none tracking-[-0.03em]">{g.boardTitle}</h2>
            <button
              type="button"
              onClick={() => {
                if (boardFrom === "over" && run) {
                  setPhase("over");
                  setSheetOpen(true);
                } else setPhase("menu");
              }}
              className={`min-h-11 rounded-full bg-c-wash px-5 text-sm font-bold ${focusRing}`}
              data-testid="m3-board-close"
            >
              {g.closeBoard}
            </button>
          </div>
          <LeaderboardView hasPrize={hasPrize} wechatId={wechatId.trim()} version={boardVersion} fetcher={fetchM3Leaderboard} />
        </main>
      </Shell>
    );
  }

  // ---------------- menu ----------------
  if (phase === "menu") {
    const rules = hasPrize ? [g.rules, owner ? fill(g.rulesContact, { id: owner }) : ""].join("") : copy.customer.gameHub.rules;
    return (
      <Shell>
        {top}
        <main className="flex flex-1 flex-col px-5 pb-[calc(24px+env(safe-area-inset-bottom))]">
          <h1 className="font-display m-0 mt-2 text-[34px] leading-[1.1] tracking-[-0.04em]">{t.title}</h1>
          <p className="m-0 mt-2 text-sm leading-relaxed text-c-grey">{t.startHint}</p>
          <div className="m3-help-cards">
            {(["roll", "big"] as const).map(kind => <div key={kind} className="m3-help-card" data-testid={`m3-help-${kind}`}>
              <span className="m3-help-art"><SpecialMark kind={kind} /></span>
              <div><b className="font-display">{t.specialHelp[kind].match}</b><span>{t.specialHelp[kind].effect}</span></div>
            </div>)}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-c-grey">{t.rules}</p>
          {/* Keep the full line's space, including wrapping, while the hub loads or fails. */}
          <p
            className={`font-display m-0 mt-6 text-center text-[15px] leading-snug text-c-ink ${hasPrize ? "" : "invisible"}`}
            aria-hidden={!hasPrize}
            data-testid={hasPrize ? "m3-prize-line" : undefined}
          >
            {g.prizeLine}
          </p>
          <div className="mt-4 flex flex-col gap-3">
            {save ? (
              <>
                <button type="button" onClick={resume} className={`font-display h-[72px] w-full rounded-full bg-c-ink text-lg text-c-paper ${focusRing}`} data-testid="m3-resume">
                  {g.resume}
                  <span className="font-num mt-0.5 block text-xs font-normal opacity-70" data-testid="m3-resume-score">
                    {fill(g.lastScore, { score: String(save.score) })}
                  </span>
                </button>
                <button type="button" onClick={() => setDialog("restart")} className={secondary} data-testid="m3-restart">
                  {g.restart}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setFormError(null);
                  setPhase("form");
                }}
                className={primary}
                data-testid="m3-menu-start"
              >
                {g.start}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setBoardFrom("menu");
                setPhase("board");
              }}
              className={secondary}
              data-testid="m3-open-board"
            >
              {g.viewBoard}
            </button>
          </div>
          <p className="mt-auto pt-8 text-[13px] leading-[1.7] text-c-grey" data-testid="m3-rules">
            {rules}
          </p>
        </main>
        {dialog === "restart" ? (
          <Sheet
            ref={dialogRef}
            label={g.restartTitle}
            onClosed={() => {
              setDialog(null);
              const fn = afterDialog.current;
              afterDialog.current = () => {};
              fn();
            }}
            className="px-6 pt-7 pb-[calc(24px+env(safe-area-inset-bottom))]"
            panelTestId="m3-restart-sheet"
          >
            <p className="font-display m-0 text-center text-xl leading-snug">{g.restartTitle}</p>
            <div className="mt-6 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() =>
                  closeDialogThen(() => {
                    clearM3Save();
                    setSave(null);
                    setFormError(null);
                    setPhase("form");
                  })
                }
                className={primary}
                data-testid="m3-restart-confirm"
              >
                {g.restartConfirm}
              </button>
              <button type="button" onClick={() => closeDialogThen(() => {})} className={secondary} data-testid="m3-restart-cancel">
                {g.keepPlaying}
              </button>
            </div>
          </Sheet>
        ) : null}
      </Shell>
    );
  }

  // ---------------- form ----------------
  if (phase === "form" || !run) {
    const input =
      "h-12 w-full rounded-2xl border border-c-line bg-c-paper px-4 text-base text-c-ink placeholder:text-c-grey-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-c-ink";
    return (
      <Shell>
        {top}
        <main className="flex flex-1 flex-col px-5 pb-[calc(24px+env(safe-area-inset-bottom))]">
          <h1 className="font-display m-0 mt-2 text-[34px] leading-[1.1] tracking-[-0.04em]">{t.title}</h1>
          <form onSubmit={begin} noValidate className="mt-6 flex flex-col gap-4" data-testid="m3-form">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-bold">{g.wechatLabel}</span>
              <input
                value={wechatId}
                onChange={(e) => setWechatId(e.target.value)}
                placeholder={g.wechatPlaceholder}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={errors.wechat ? true : undefined}
                aria-describedby={errors.wechat ? "m3-wechat-err" : undefined}
                className={input}
                data-testid="m3-wechat"
              />
              {errors.wechat ? (
                <span id="m3-wechat-err" role="alert" className="mt-1 block text-[13px] text-c-red">
                  {errors.wechat}
                </span>
              ) : null}
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-bold">{g.nicknameLabel}</span>
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder={g.nicknamePlaceholder}
                autoComplete="off"
                aria-invalid={errors.nick ? true : undefined}
                aria-describedby={errors.nick ? "m3-nick-err" : undefined}
                className={input}
                data-testid="m3-nickname"
              />
              {errors.nick ? (
                <span id="m3-nick-err" role="alert" className="mt-1 block text-[13px] text-c-red">
                  {errors.nick}
                </span>
              ) : null}
            </label>
            {formError ? (
              <p role="alert" className="m-0 text-sm text-c-red" data-testid="m3-form-error">
                {formError}
              </p>
            ) : null}
            <button type="submit" disabled={starting} className={`${primary} mt-1 disabled:opacity-60`} data-testid="m3-start">
              {starting ? g.starting : g.start}
            </button>
            <button type="button" onClick={() => setPhase("menu")} className={secondary} data-testid="m3-form-back">
              {g.closeBoard}
            </button>
          </form>
        </main>
      </Shell>
    );
  }

  // ---------------- playing / over ----------------
  const shownScore = finish.state === "ok" ? finish.result.score : finalScore;
  const sameScore = finish.state === "ok" && finish.result.score === finalScore;
  return (
    <Shell>
      {top}
      <main className="relative flex flex-1 flex-col" style={{ minHeight: "calc(100svh - 56px)" }}>
        <M3Board key={run.key} tiers={run.tiers} seed={run.seed} initialMoves={run.initialMoves} soundOn={soundOn} reduced={reduced} onProgress={onProgress} onOver={onOver} onShowResult={phase === "over" ? () => setSheetOpen(true) : undefined} />
        {phase === "over" && !sheetOpen ? (
          <div
            className="absolute inset-x-2 bottom-[calc(12px+env(safe-area-inset-bottom))] z-50 flex h-12 items-stretch overflow-hidden rounded-full border border-c-line bg-c-paper/90 text-c-ink backdrop-blur-sm"
            data-testid="m3-bar"
          >
            <button type="button" onClick={() => void begin()} disabled={finish.state === "submitting"} className={`font-display flex-1 text-base disabled:opacity-50 ${focusRing}`} data-testid="m3-bar-again">
              {g.barAgain}
            </button>
            <span aria-hidden="true" className="self-center opacity-50">
              ·
            </span>
            <button type="button" onClick={() => setSheetOpen(true)} className={`font-display flex-1 text-base ${focusRing}`} data-testid="m3-bar-score">
              {g.barScore}
            </button>
          </div>
        ) : null}
      </main>

      {phase === "playing" && dialog === "exit" ? (
        <Sheet
          ref={dialogRef}
          label={g.exitTitle}
          onClosed={() => {
            if (phaseRef.current !== "playing") return;
            setDialog(null);
            const fn = afterDialog.current;
            afterDialog.current = () => {};
            fn();
          }}
          className="px-6 pt-7 pb-[calc(24px+env(safe-area-inset-bottom))]"
          panelTestId="m3-exit-sheet"
        >
          <p className="font-display m-0 text-center text-xl leading-snug">{g.exitTitle}</p>
          <div className="mt-6 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={() =>
                closeDialogThen(() => {
                  persist();
                  toMenu();
                })
              }
              className={primary}
              data-testid="m3-exit-save"
            >
              {g.exitSave}
            </button>
            <button
              type="button"
              onClick={() =>
                closeDialogThen(() => {
                  clearM3Save();
                  toMenu();
                })
              }
              className={secondary}
              data-testid="m3-exit-discard"
            >
              {g.exitDiscard}
            </button>
          </div>
        </Sheet>
      ) : null}

      {phase === "over" && sheetOpen ? (
        <Sheet
          ref={sheetRef}
          label={g.overTitle}
          onClosed={() => {
            setSheetOpen(false);
            const fn = afterSheet.current;
            afterSheet.current = () => {};
            fn();
          }}
          className="px-6 pt-7 pb-[calc(24px+env(safe-area-inset-bottom))]"
          panelTestId="m3-over-sheet"
        >
          <button
            type="button"
            onClick={() => sheetRef.current?.close()}
            aria-label={g.close}
            className={`absolute top-2 right-2 grid size-11 place-items-center rounded-full text-c-ink ${focusRing}`}
            data-testid="m3-over-close"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          <h2 className="font-display m-0 text-center text-[28px] leading-none tracking-[-0.03em]">{g.overTitle}</h2>
          <p className="m-0 mt-5 text-center text-xs font-bold text-c-grey">{g.finalScore}</p>
          <p className="font-num m-0 text-center text-[56px] leading-[1.1]" data-testid="m3-final-score">
            {shownScore}
          </p>
          <div className="mt-2 min-h-[72px] text-center" aria-live="polite" data-testid="m3-finish">
            {finish.state === "submitting" ? (
              <p className="m-0 text-sm text-c-grey">{g.submitting}</p>
            ) : finish.state === "failed" ? (
              <>
                <p className="m-0 text-sm text-c-red" role="alert">
                  {g.submitFailed}
                </p>
                {finish.retry ? (
                  <button type="button" onClick={() => void submit(runId.current, progress.current.moves, true)} className={`mt-2 min-h-11 rounded-full bg-c-wash px-6 text-sm font-bold ${focusRing}`} data-testid="m3-retry">
                    {g.retry}
                  </button>
                ) : (
                  <p className="m-0 mt-1 text-[13px] text-c-grey">{finish.message}</p>
                )}
              </>
            ) : (
              <div className="flex items-start justify-center gap-8">
                {sameScore ? (
                  <p className="m-0 text-sm font-bold" data-testid="m3-confirmed">
                    {g.confirmed}
                    {finish.result.rank != null ? (
                      <span className="mt-0.5 block text-base">
                        {g.rankPre} <b className="font-num text-xl font-normal">{finish.result.rank}</b> {g.rankPost}
                      </span>
                    ) : null}
                  </p>
                ) : (
                  <p className="m-0 text-sm text-c-grey" data-testid="m3-differs">
                    {g.scoreDiffers}
                  </p>
                )}
                <p className="m-0 text-sm font-bold">
                  {g.best}
                  <span className="font-num mt-0.5 block text-xl font-normal" data-testid="m3-best">
                    {finish.result.best}
                  </span>
                </p>
              </div>
            )}
          </div>
          {finish.state === "ok" && typeof finish.result.personalBest === "number" ? (
            <div className="mt-1 text-center">
              {finish.result.newRecord ? (
                <p className={`font-display m-0 mb-1 text-xl ${reduced || degraded ? "m3-record-fade" : "m3-record-pop"}`} data-testid="m3-new-record">
                  {g.newRecord}
                </p>
              ) : null}
              <p className="m-0 text-sm font-bold">
                {g.personalBest}{" "}
                <span className="font-num text-xl font-normal" data-testid="m3-personal-best">
                  {finish.result.personalBest}
                </span>
              </p>
            </div>
          ) : null}
          <div className="mt-4 flex flex-col gap-2.5">
            <button type="button" onClick={() => closeSheetThen(() => void begin())} className={`${primary} disabled:opacity-50`} disabled={finish.state === "submitting"} data-testid="m3-again">
              {finish.state === "failed" ? g.againDiscard : g.again}
            </button>
            <button
              type="button"
              onClick={() =>
                closeSheetThen(() => {
                  setBoardFrom("over");
                  setPhase("board");
                })
              }
              className={secondary}
              data-testid="m3-to-board"
            >
              {g.toBoard}
            </button>
          </div>
        </Sheet>
      ) : null}
    </Shell>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useBgm } from "@/components/game/bgm";
import { GameTutorial } from "@/components/game/GameTutorial";
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
import { GameMenuHero, GameRegistrationField, GameResultArt, GameShell as Shell, SpeakerButton, ReplayButton, gamePrimary, gameSecondary } from "@/components/game/GameChrome";
import { copy } from "@/copy";
import { elapsedTick } from "./grabClock";
import { fetchMenu } from "@/lib/api";
import { useMotionPrefs } from "@/lib/motion/react";
import { GrabBoard, type GrabBoardHandle, type GrabProgress } from "./GrabBoard";
import { GrabRules } from "./GrabArt";
import { fetchGrabLeaderboard, finishGrab, startGrab } from "./grabApi";
import { clearGrabSave, grabSaveLevel, readGrabSave, writeGrabSave, type GrabSave } from "./grabSave";

const g = copy.customer.game;
const t = copy.customer.grab;
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
  initialLaunches: number[];
  initialElapsedMs: number;
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

export function GrabPage() {
  const { reduced, degraded } = useMotionPrefs();
  const { data: hub } = useGameHub();
  const hasPrize = hub?.prizeGame === "GRAB";
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
  const progress = useRef<GrabProgress>({ launches: [], score: 0, elapsedMs: 0, endTick: 0 });
  const [finish, setFinish] = useState<Finish>({ state: "submitting" });
  const [finalScore, setFinalScore] = useState(0);
  const [finalStats, setFinalStats] = useState({ level: 1, levelScore: 0, levelTarget: 0, orders: 0 });
  const [myLevel, setMyLevel] = useState<number | null>(null);
  const [save, setSave] = useState<GrabSave | null>(null);
  const saveLevel = useMemo(() => (save ? grabSaveLevel(save) : null), [save]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [boardVersion, setBoardVersion] = useState(0);
  const [boardFrom, setBoardFrom] = useState<"menu" | "over">("menu");
  const [dialog, setDialog] = useState<"restart" | "exit" | "replay" | null>(null);
  const dialogRef = useRef<SheetHandle>(null);
  const boardRef = useRef<GrabBoardHandle>(null);
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
    setSave(readGrabSave());
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

  // The menu's level badge: the best level this player reached (from the board), unless a run is saved.
  useEffect(() => {
    const w = wechatId.trim();
    if (!w) return;
    let alive = true;
    void fetchGrabLeaderboard(w).then(r => { if (alive && r.ok && typeof r.data.myLevel === "number") setMyLevel(r.data.myLevel); });
    return () => { alive = false; };
  }, [wechatId]);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    writeRemembered({ sound: next });
    if (next) {
      unlockAudio();
      sound.drop();
    }
  };

  const submit = useCallback(async (id: string, p: GrabProgress, retry = false) => {
    if (!retry && submitted.current.has(id)) return;
    if (inflight.current === id) return;
    submitted.current.add(id);
    inflight.current = id;
    setFinish({ state: "submitting" });
    const r = await finishGrab(id, p.launches, p.endTick);
    if (inflight.current === id) inflight.current = null;
    if (runId.current !== id) return;
    if (r.ok) {
      // Keep completed logs retryable until the server acknowledges this exact run.
      if (readGrabSave()?.runId === id) clearGrabSave();
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
    writeGrabSave({ v: 1, runId: runId.current, seed: m.seed, tiers: m.tiers, launches: p.launches, elapsedMs: p.elapsedMs, nickname: m.nickname, expiresAt: m.expiresAt, score: p.score });
  }, []);
  useEffect(() => {
    const hide = () => { if (document.hidden) persist(); };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", persist);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", persist);
    };
  }, [persist]);
  const onProgress = useCallback(
    (p: GrabProgress) => {
      const previous = progress.current;
      progress.current = p;
      if (p.launches.length !== previous.launches.length || Math.floor(p.elapsedMs / 1000) !== Math.floor(previous.elapsedMs / 1000) || p.endTick === 0) persist();
    },
    [persist],
  );

  const readProgress = useCallback(() => runId.current && !submitted.current.has(runId.current)
    ? { runId: runId.current, log: progress.current.launches, endTick: progress.current.endTick } : null, []);
  useLiveProgress("/api/game/grab/progress", phase === "playing", readProgress);

  const toMenu = () => {
    phaseRef.current = "menu";
    setRun(null);
    setSheetOpen(false);
    setSave(readGrabSave());
    setPhase("menu");
  };

  const resume = () => {
    const sv = readGrabSave();
    if (!sv) {
      clearGrabSave();
      setSave(null);
      return;
    }
    if (soundOn) unlockAudio();
    submitted.current.delete(sv.runId);
    runId.current = sv.runId;
    inflight.current = null;
    meta.current = { seed: sv.seed, expiresAt: sv.expiresAt, nickname: sv.nickname, tiers: sv.tiers };
    progress.current = { launches: sv.launches, score: sv.score, elapsedMs: sv.elapsedMs, endTick: elapsedTick(sv.elapsedMs) };
    setRun({ key: sv.runId, seed: sv.seed, tiers: sv.tiers, initialLaunches: sv.launches, initialElapsedMs: sv.elapsedMs });
    setSheetOpen(false);
    setPhase("playing");
  };

  const closeDialogThen = (fn: () => void) => {
    afterDialog.current = fn;
    dialogRef.current?.close();
  };

  /** Abandon the current run without a finish, then start a fresh one (skips the form). */
  const replay = () => {
    submitted.current.add(runId.current);
    clearGrabSave();
    void begin();
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
    const r = await startGrab(w, n);
    setStarting(false);
    if (!r.ok || !Array.isArray(r.data.tiers) || r.data.tiers.length < 3) {
      setFormError(r.ok || r.error.error.toLowerCase() === "unavailable" ? t.unavailable : r.error.message);
      setSheetOpen(false);
      setPhase("form");
      return;
    }
    writeRemembered({ wechatId: w, nickname: n });
    clearGrabSave();
    meta.current = { seed: r.data.seed, expiresAt: r.data.expiresAt, nickname: r.data.nickname ?? n, tiers: r.data.tiers };
    runId.current = r.data.runId;
    inflight.current = null;
    progress.current = { launches: [], score: 0, elapsedMs: 0, endTick: 0 };
    writeGrabSave({ v: 1, runId: r.data.runId, seed: r.data.seed, tiers: r.data.tiers, launches: [], elapsedMs: 0, nickname: r.data.nickname ?? n, expiresAt: r.data.expiresAt, score: 0 });
    setFinish({ state: "submitting" });
    setRun({ key: r.data.runId, seed: r.data.seed, tiers: r.data.tiers, initialLaunches: [], initialElapsedMs: 0 });
    setSheetOpen(false);
    setPhase("playing");
  };

  const onOver = useCallback(
    (p: GrabProgress) => {
      if (submitted.current.has(runId.current)) return;
      // Unmount Exit (releasing its focus trap/scroll lock) before showing results.
      // Its closing animation may still resolve: discard any queued menu/discard action.
      afterDialog.current = () => {};
      setDialog(null);
      progress.current = p;
      persist();
      phaseRef.current = "over";
      setFinalScore(p.score);
      setFinalStats({ level: p.level ?? 1, levelScore: p.levelScore ?? 0, levelTarget: p.levelTarget ?? 0, orders: p.completedOrders ?? 0 });
      setRun(r => r ? { ...r, initialLaunches: p.launches, initialElapsedMs: p.elapsedMs } : r);
      setPhase("over");
      const id = runId.current;
      void submit(id, p);
      timers.current.push(setTimeout(() => {
        if (runId.current === id && phaseRef.current === "over") setSheetOpen(true);
      }, reduced ? 0 : SHEET_DELAY_MS));
    },
    [persist, reduced, submit],
  );

  const closeSheetThen = (fn: () => void) => {
    afterSheet.current = fn;
    sheetRef.current?.close();
  };

  const openExit = () => {
    boardRef.current?.pause();
    // Pausing can deliver the final active tick and end the run.
    if (phaseRef.current === "playing") setDialog("exit");
  };

  // Background music only while actually playing with sound on (pause sheets keep it quiet).
  useBgm("grab", soundOn && phase === "playing" && dialog === null);

  const top = (
    <div onClickCapture={e => {
      if (phase === "playing" && (e.target as Element).closest("a")) { e.preventDefault(); openExit(); }
    }}>
    <TopBar
      backHref="/game/hub"
      backLabel={copy.customer.gameHub.backLabel}
      title={phase === "board" ? t.pageTitle : undefined}
      titleAs="p"
      right={
        <div className="flex items-center">
          {phase === "playing" ? <ReplayButton testId="grab-replay" onClick={() => setDialog("replay")} /> : null}
          {phase === "playing" ? (
            <button type="button" onClick={openExit} className={`min-h-11 shrink-0 rounded-full px-3 text-sm font-bold text-c-ink ${focusRing}`} data-testid="grab-exit">
              {g.exit}
            </button>
          ) : null}
          <SpeakerButton testId="grab-sound" on={soundOn} onToggle={toggleSound} />
        </div>
      }
    />
    </div>
  );

  const primary = gamePrimary;
  const secondary = gameSecondary;

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
              data-testid="grab-board-close"
            >
              {g.closeBoard}
            </button>
          </div>
          <LeaderboardView levelLabel={t.level} hasPrize={hasPrize} wechatId={wechatId.trim()} version={boardVersion} fetcher={fetchGrabLeaderboard} />
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
          <GameMenuHero game="grab" title={t.title} hint={t.startHint}>
            {saveLevel || myLevel ? <p className="game-hero-badge font-display" data-testid="grab-menu-level">{saveLevel ? fill(t.level, { n: saveLevel }) : fill(t.menuBest, { n: myLevel ?? 1 })}</p> : null}
          </GameMenuHero>
          <GrabRules />
          <p className="mt-2 text-xs leading-relaxed text-c-grey">{t.rules}</p>
          {/* Keep the full line's space, including wrapping, while the hub loads or fails. */}
          <p
            className={`font-display m-0 mt-6 text-center text-[15px] leading-snug text-c-ink ${hasPrize ? "" : "invisible"}`}
            aria-hidden={!hasPrize}
            data-testid={hasPrize ? "grab-prize-line" : undefined}
          >
            {g.prizeLine}
          </p>
          <div className="mt-4 flex flex-col gap-3">
            {save ? (
              <>
                <button type="button" onClick={resume} className={`font-display h-[72px] w-full rounded-full bg-c-ink text-lg text-c-paper ${focusRing}`} data-testid="grab-resume">
                  {g.resume}
                  <span className="font-num mt-0.5 block text-xs font-normal opacity-70" data-testid="grab-resume-score">
                    {fill(g.lastScore, { score: String(save.score) })}
                  </span>
                </button>
                <button type="button" onClick={() => setDialog("restart")} className={secondary} data-testid="grab-restart">
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
                data-testid="grab-menu-start"
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
              data-testid="grab-open-board"
            >
              {g.viewBoard}
            </button>
            <GameTutorial game="grab" />
          </div>
          <p className="mt-auto pt-8 text-[13px] leading-[1.7] text-c-grey" data-testid="grab-rules">
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
            panelTestId="grab-restart-sheet"
          >
            <p className="font-display m-0 text-center text-xl leading-snug">{g.restartTitle}</p>
            <div className="mt-6 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() =>
                  closeDialogThen(() => {
                    clearGrabSave();
                    setSave(null);
                    setFormError(null);
                    setPhase("form");
                  })
                }
                className={primary}
                data-testid="grab-restart-confirm"
              >
                {g.restartConfirm}
              </button>
              <button type="button" onClick={() => closeDialogThen(() => {})} className={secondary} data-testid="grab-restart-cancel">
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
    return (
      <Shell>
        {top}
        <main className="flex flex-1 flex-col px-5 pb-[calc(24px+env(safe-area-inset-bottom))]">
          <GameMenuHero game="grab" title={t.title} compact />
          <form onSubmit={begin} noValidate className="mt-6 flex flex-col gap-4" data-testid="grab-form">
            <GameRegistrationField kind="wechat" testId="grab-wechat" value={wechatId} onChange={(e) => setWechatId(e.target.value)} error={errors.wechat} errorId="grab-wechat-err" />
            <GameRegistrationField kind="nickname" testId="grab-nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} error={errors.nick} errorId="grab-nick-err" />
            {formError ? (
              <p role="alert" className="m-0 text-sm text-c-red" data-testid="grab-form-error">
                {formError}
              </p>
            ) : null}
            <button type="submit" disabled={starting} className={`${primary} mt-1 disabled:opacity-60`} data-testid="grab-start">
              {starting ? g.starting : g.start}
            </button>
            <button type="button" onClick={() => setPhase("menu")} className={secondary} data-testid="grab-form-back">
              {g.closeBoard}
            </button>
          </form>
        </main>
      </Shell>
    );
  }

  // ---------------- playing / over ----------------
  const shownScore = finish.state === "ok" ? finish.result.score : finalScore;
  const shownLevel = finish.state === "ok" && typeof finish.result.level === "number" ? finish.result.level : finalStats.level;
  const shownOrders = finish.state === "ok" && typeof finish.result.completedOrders === "number" ? finish.result.completedOrders : finalStats.orders;
  const missing = Math.max(0, finalStats.levelTarget - finalStats.levelScore);
  const sameScore = finish.state === "ok" && finish.result.score === finalScore;
  return (
    <Shell>
      {top}
      <main className="grab-main">
        <GrabBoard ref={boardRef} key={run.key} tiers={run.tiers} seed={run.seed} initialLaunches={run.initialLaunches} initialElapsedMs={run.initialElapsedMs} paused={dialog !== null || phase !== "playing"} soundOn={soundOn} reduced={reduced} onProgress={onProgress} onOver={onOver} onShowResult={phase === "over" ? () => setSheetOpen(true) : undefined} />
        {phase === "over" && !sheetOpen ? (
          <div
            className="absolute inset-x-2 bottom-[calc(12px+env(safe-area-inset-bottom))] z-50 flex h-12 items-stretch overflow-hidden rounded-full border border-c-line bg-c-paper/90 text-c-ink backdrop-blur-sm"
            data-testid="grab-bar"
          >
            <button type="button" onClick={() => void begin()} disabled={finish.state === "submitting"} className={`font-display flex-1 text-base disabled:opacity-50 ${focusRing}`} data-testid="grab-bar-again">
              {g.barAgain}
            </button>
            <span aria-hidden="true" className="self-center opacity-50">
              ·
            </span>
            <button type="button" onClick={() => setSheetOpen(true)} className={`font-display flex-1 text-base ${focusRing}`} data-testid="grab-bar-score">
              {g.barScore}
            </button>
          </div>
        ) : null}
      </main>

      {phase === "playing" && dialog === "replay" ? (
        <Sheet
          ref={dialogRef}
          label={g.replayTitle}
          onClosed={() => {
            if (phaseRef.current !== "playing") return;
            setDialog(null);
            const fn = afterDialog.current;
            afterDialog.current = () => {};
            fn();
          }}
          className="px-6 pt-7 pb-[calc(24px+env(safe-area-inset-bottom))]"
          panelTestId="grab-replay-sheet"
        >
          <p className="font-display m-0 text-center text-xl leading-snug">{g.replayTitle}</p>
          <div className="mt-6 flex flex-col gap-2.5">
            <button type="button" onClick={() => closeDialogThen(replay)} className={gamePrimary} data-testid="grab-replay-level">
              {g.replayRound}
            </button>
            <button type="button" onClick={() => closeDialogThen(() => {})} className={gameSecondary} data-testid="grab-replay-cancel">
              {g.replayCancel}
            </button>
          </div>
        </Sheet>
      ) : null}

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
          panelTestId="grab-exit-sheet"
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
              data-testid="grab-exit-save"
            >
              {g.exitSave}
            </button>
            <button
              type="button"
              onClick={() =>
                closeDialogThen(() => {
                  clearGrabSave();
                  toMenu();
                })
              }
              className={secondary}
              data-testid="grab-exit-discard"
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
          panelTestId="grab-over-sheet"
        >
          <button
            type="button"
            onClick={() => sheetRef.current?.close()}
            aria-label={g.close}
            className={`absolute top-2 right-2 grid size-11 place-items-center rounded-full text-c-ink ${focusRing}`}
            data-testid="grab-over-close"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          <GameResultArt record={finish.state === "ok" && !!finish.result.newRecord} lose={!(finish.state === "ok" && finish.result.newRecord)} />
          <h2 className="font-display m-0 text-center text-[28px] leading-none tracking-[-0.03em]" data-testid="grab-fail-title">{fill(t.failTitle, { n: shownLevel })}</h2>
          {missing > 0 ? <p className="font-num m-0 mt-1.5 text-center text-sm text-c-grey" data-testid="grab-fail-short">{fill(t.short, { n: missing })}</p> : null}
          <p className="m-0 mt-5 text-center text-xs font-bold text-c-grey">{g.finalScore}</p>
          <p className="font-num m-0 text-center text-[56px] leading-[1.1]" data-testid="grab-final-score">
            {shownScore}
          </p>
          <div className="mt-1 flex items-start justify-center gap-8 text-center text-sm font-bold">
            <p className="m-0">{t.reached}<span className="font-num mt-0.5 block text-xl font-normal" data-testid="grab-reached">{shownLevel}</span></p>
            <p className="m-0">{t.orders}<span className="font-num mt-0.5 block text-xl font-normal" data-testid="grab-orders-done">{shownOrders}</span></p>
          </div>
          <div className="mt-2 min-h-[72px] text-center" aria-live="polite" data-testid="grab-finish">
            {finish.state === "submitting" ? (
              <p className="m-0 text-sm text-c-grey">{g.submitting}</p>
            ) : finish.state === "failed" ? (
              <>
                <p className="m-0 text-sm text-c-red" role="alert">
                  {g.submitFailed}
                </p>
                {finish.retry ? (
                  <button type="button" onClick={() => void submit(runId.current, progress.current, true)} className={`mt-2 min-h-11 rounded-full bg-c-wash px-6 text-sm font-bold ${focusRing}`} data-testid="grab-retry">
                    {g.retry}
                  </button>
                ) : (
                  <p className="m-0 mt-1 text-[13px] text-c-grey">{finish.message}</p>
                )}
              </>
            ) : (
              <div className="flex items-start justify-center gap-8">
                {sameScore ? (
                  <p className="m-0 text-sm font-bold" data-testid="grab-confirmed">
                    {g.confirmed}
                    {finish.result.rank != null ? (
                      <span className="mt-0.5 block text-base">
                        {g.rankPre} <b className="font-num text-xl font-normal">{finish.result.rank}</b> {g.rankPost}
                      </span>
                    ) : null}
                  </p>
                ) : (
                  <p className="m-0 text-sm text-c-grey" data-testid="grab-differs">
                    {g.scoreDiffers}
                  </p>
                )}
                <p className="m-0 text-sm font-bold">
                  {g.best}
                  <span className="font-num mt-0.5 block text-xl font-normal" data-testid="grab-best">
                    {finish.result.best}
                  </span>
                </p>
              </div>
            )}
          </div>
          {finish.state === "ok" && typeof finish.result.personalBest === "number" ? (
            <div className="mt-1 text-center">
              {finish.result.newRecord ? (
                <p className={`font-display m-0 mb-1 text-xl ${reduced || degraded ? "grab-record-fade" : "grab-record-pop"}`} data-testid="grab-new-record">
                  {g.newRecord}
                </p>
              ) : null}
              <p className="m-0 text-sm font-bold">
                {g.personalBest}{" "}
                <span className="font-num text-xl font-normal" data-testid="grab-personal-best">
                  {finish.result.personalBest}
                </span>
              </p>
            </div>
          ) : null}
          <div className="mt-4 flex flex-col gap-2.5">
            <button type="button" onClick={() => closeSheetThen(() => void begin())} className={`${primary} disabled:opacity-50`} disabled={finish.state === "submitting"} data-testid="grab-again">
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
              data-testid="grab-to-board"
            >
              {g.toBoard}
            </button>
          </div>
        </Sheet>
      ) : null}
    </Shell>
  );
}

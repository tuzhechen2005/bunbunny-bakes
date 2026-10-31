"use client";

import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from "react";
import { copy } from "@/copy";
import { fill } from "@/components/customer/format";
import type { TierView } from "@/components/game/types";
import { sound } from "@/components/game/sound";
import { haptic, useMotionPrefs } from "@/lib/motion/react";
import { createGrabGame, FIELD_WIDTH, FIELD_HEIGHT, OVEN_X, OVEN_Y, RUN_TICKS, type GrabEvent, type GrabItem, type GrabState } from "@/lib/grab";
import { GrabArt, GrabFace } from "./GrabArt";
import { createGrabClock, elapsedTick } from "./grabClock";
import { grabPresentationKey, isGrabRefilling } from "./grabPresentation";
import "./grab.css";

const t = copy.customer.grab;
export interface GrabProgress { launches: number[]; score: number; elapsedMs: number; endTick: number }
export interface GrabBoardHandle { pause: () => void }
interface Props {
  ref?: Ref<GrabBoardHandle>;
  seed: string; tiers: TierView[]; initialLaunches?: number[]; initialElapsedMs?: number;
  soundOn: boolean; reduced: boolean; paused: boolean;
  onProgress: (p: GrabProgress) => void; onOver: (p: GrabProgress) => void; onShowResult?: () => void;
}
type ScorePop = Extract<GrabEvent, { type: "score" }>;

const GrabSprite = memo(function GrabSprite({ bread, tiers, held = false, refilling = false }: {
  bread: GrabItem; tiers: TierView[]; held?: boolean; refilling?: boolean;
}) {
  return <span className={`grab-item${held ? " grab-held" : refilling ? " grab-refill" : ""}`} data-kind={bread.kind} data-stage={bread.stage}
    style={{ left: `${(held ? 0 : bread.x) / FIELD_WIDTH * 100}%`, top: `${(held ? 0 : bread.y) / FIELD_HEIGHT * 100}%`, width: `${bread.radius * 2 / FIELD_WIDTH * 100}%`, height: `${bread.radius * 2 / FIELD_HEIGHT * 100}%`, "--rot": `${(bread.id * 37) % 13 - 6}deg`, "--from-x": `${(OVEN_X - bread.x) / (bread.radius * 2) * 100}%`, "--from-y": `${(OVEN_Y - bread.y) / (bread.radius * 2) * 100}%` } as CSSProperties}>
    <GrabFace item={bread} tiers={tiers} />
  </span>;
}, (a, b) => a.tiers === b.tiers && a.held === b.held && a.refilling === b.refilling &&
  a.bread.id === b.bread.id && a.bread.stage === b.bread.stage &&
  (a.held || (a.bread.x === b.bread.x && a.bread.y === b.bread.y)));

export function GrabBoard({ ref, seed, tiers, initialLaunches = [], initialElapsedMs = 0, soundOn, reduced, paused, onProgress, onOver, onShowResult }: Props) {
  const { degraded } = useMotionPrefs();
  const quiet = reduced || degraded;
  const [game] = useState(() => {
    const g = createGrabGame({ seed, tiers });
    initialLaunches.forEach(tick => g.launch(tick));
    g.step(elapsedTick(initialElapsedMs));
    return g;
  });
  const [clock] = useState(() => createGrabClock(initialElapsedMs));
  const launches = useRef([...initialLaunches]);
  const [snap, setSnap] = useState(() => game.state());
  const [hidden, setHidden] = useState(false);
  const [pops, setPops] = useState<ScorePop[]>([]);
  const [ovenWarm, setOvenWarm] = useState(false);
  const ovenUntil = useRef(-1);
  const livePops = useRef<ScorePop[]>([]);
  const presentation = useRef("");
  const board = useRef<HTMLButtonElement>(null);
  const arm = useRef<HTMLSpanElement>(null);
  const armSegment = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const heldPosition = useRef<HTMLSpanElement>(null);
  const tipShadow = useRef<HTMLSpanElement>(null);
  const paint = useCallback((state: GrabState) => {
    if (tipShadow.current) {
      tipShadow.current.style.transform = `translate(${(state.claw.x + 14) / FIELD_WIDTH * 100}%, ${(state.claw.y + 22) / FIELD_HEIGHT * 100}%)`;
      tipShadow.current.style.opacity = state.claw.phase === "idle" ? "0" : "1";
    }
    if (arm.current) arm.current.style.transform = `rotate(${-state.claw.angle}deg)`;
    if (armSegment.current) armSegment.current.style.transform = `scaleY(${state.claw.length / FIELD_HEIGHT})`;
    if (tip.current) tip.current.style.transform = `translateY(${state.claw.length / FIELD_HEIGHT * 100}%)`;
    if (heldPosition.current) heldPosition.current.style.transform = `translate(${state.claw.x / FIELD_WIDTH * 100}%, ${state.claw.y / FIELD_HEIGHT * 100}%)`;
    if (board.current) {
      board.current.dataset.tick = String(state.tick);
      board.current.dataset.phase = state.claw.phase;
      board.current.dataset.launches = String(state.launchesAccepted);
    }
  }, []);
  // Paint new held DOM immediately on commit, including restored saves.
  useLayoutEffect(() => { paint(game.state()); });
  const raf = useRef<number | null>(null);
  const reported = useRef(false);
  const active = useRef(false);
  const lastFeedback = useRef(-1);
  const lastPointerEvent = useRef(-Infinity);

  const publish = useCallback((events: GrabEvent[], render = true) => {
    const state = game.state();
    const elapsedMs = state.tick * 1000 / 60;
    const progress = { launches: launches.current, score: state.score, elapsedMs, endTick: state.tick };
    onProgress(progress);
    if (render) {
      paint(state);
      const scores = events.filter((e): e is ScorePop => e.type === "score");
      livePops.current = [...livePops.current.filter(e => state.tick - e.tick < 48), ...scores]
        .filter(e => state.tick - e.tick < 48).slice(-4);
      for (const event of events) if (event.type === "refill") ovenUntil.current = event.tick + 30;
      const warm = state.tick < ovenUntil.current;
      const key = `${grabPresentationKey(state)}|${warm}|${livePops.current.map(e => e.item).join(",")}`;
      if (key !== presentation.current) {
        presentation.current = key;
        setSnap(state);
        setPops(livePops.current);
        setOvenWarm(warm);
      }
      if (scores.length && state.tick !== lastFeedback.current) {
        lastFeedback.current = state.tick;
        if (soundOn) sound.merge(1);
        if (!quiet) haptic(8);
      }
      if (state.over && !reported.current) {
        reported.current = true;
        if (soundOn) sound.over();
        onOver(progress);
      }
    }
  }, [game, onOver, onProgress, paint, quiet, soundOn]);

  const stop = useCallback(() => {
    // Freeze at the input event, before React renders the exit sheet or runs effects.
    const elapsed = clock.pause(performance.now());
    active.current = false;
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    publish(game.step(elapsedTick(elapsed)));
  }, [clock, game, publish]);
  useImperativeHandle(ref, () => ({ pause: stop }), [stop]);

  useEffect(() => {
    const frame = () => {
      if (!active.current) return;
      publish(game.step(elapsedTick(clock.read(performance.now()))));
      if (!game.over) raf.current = requestAnimationFrame(frame);
      else { active.current = false; raf.current = null; clock.pause(performance.now()); }
    };
    const start = () => {
      if (paused || document.hidden || game.over) return;
      if (active.current) return;
      active.current = true;
      clock.resume(performance.now());
      raf.current = requestAnimationFrame(frame);
    };
    const visibility = () => {
      setHidden(document.hidden);
      if (document.hidden) stop(); else start();
    };
    // Capture first so the shared progress reporter sees the final active tick on hide.
    document.addEventListener("visibilitychange", visibility, true);
    window.addEventListener("pagehide", stop, true);
    const boot = setTimeout(() => { publish([]); start(); }, 0);
    return () => {
      clearTimeout(boot);
      active.current = false;
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
      const elapsed = clock.pause(performance.now());
      publish(game.step(elapsedTick(elapsed)), false);
      document.removeEventListener("visibilitychange", visibility, true);
      window.removeEventListener("pagehide", stop, true);
    };
  }, [clock, game, paused, publish, stop]);

  const launch = () => {
    if (game.over) { onShowResult?.(); return; }
    if (paused || document.hidden) return;
    // A press can arrive before the deferred first frame (or during an effect restart).
    // Eligibility depends on gameplay state, never on whether rAF has booted yet.
    clock.resume(performance.now());
    const tick = elapsedTick(clock.read(performance.now()));
    const events = game.step(tick);
    // Busy taps have no gameplay effect; omit them from the canonical client log.
    if (!game.over && game.state().claw.phase === "idle" && tick > (launches.current.at(-1) ?? -1)) {
      if (game.launch(tick)) { launches.current = [...launches.current, tick]; if (soundOn) sound.drop(); }
    }
    publish(events);
  };
  const seconds = Math.ceil(snap.timeLeft / 60);
  return <section className={`grab-play${quiet ? " grab-quiet" : ""}${paused || hidden || snap.over ? " grab-still" : ""}${seconds <= 10 && !snap.over ? " grab-hurry" : ""}`}>
    <div className="grab-hud">
      <p>{t.timer}<b className="font-num" data-testid="grab-timer">{seconds}</b></p>
      <p>{t.score}<b key={snap.score} className={`font-num${snap.score ? " grab-bump" : ""}`} data-testid="grab-score">{snap.score}</b></p>
    </div>
    <div className="grab-timebar" aria-hidden="true"><i style={{ transform: `scaleX(${Math.min(1, Math.max(0, snap.timeLeft - 60) / RUN_TICKS)})` }} /></div>
    <div className="grab-bakery" aria-hidden="true" />
    <div className="grab-field-space">
    <div className="grab-field-frame" style={{ aspectRatio: `${FIELD_WIDTH} / ${FIELD_HEIGHT}`, "--grab-aspect": FIELD_WIDTH / FIELD_HEIGHT } as CSSProperties}>
    <GrabArt name="bunny" className="grab-bunny" />
    <button ref={board} type="button" className="grab-board"
      onPointerDown={e => {
        lastPointerEvent.current = performance.now();
        if (e.button === 0 && (e.pointerType === "mouse" || e.isPrimary)) launch();
      }}
      // Refresh at release too, so a long press cannot launch again when it ends.
      onPointerUp={() => { lastPointerEvent.current = performance.now(); }}
      onPointerCancel={() => { lastPointerEvent.current = performance.now(); }}
      // Fall back to clicks when no pointer event was delivered, regardless of touch
      // capability. Suppress the compatibility click following a pointer/touch input.
      onClick={e => {
        if (e.detail === 0 || performance.now() - lastPointerEvent.current > 500) launch();
      }} aria-label={t.boardLabel} data-testid="grab-board" >
      <GrabArt name="oven" className={`grab-oven${ovenWarm ? " grab-oven-warm" : ""}`} />
      {snap.items.map(bread => <GrabSprite key={bread.id} bread={bread} tiers={tiers} refilling={isGrabRefilling(bread, snap.tick)} />)}
      <span ref={tipShadow} className="grab-tip-shadow" aria-hidden="true" />
      <span ref={arm} className="grab-arm">
        <span ref={armSegment} className="grab-arm-scale"><GrabArt name="arm" className="grab-arm-segment" /></span>
        <span ref={tip} className="grab-tip"><GrabArt name="tongs" className="grab-tongs" /></span>
      </span>
      <span ref={heldPosition} className="grab-held-position">
        {snap.claw.held && <GrabSprite key={snap.claw.held.id} bread={snap.claw.held} tiers={tiers} held />}
      </span>
      {pops.map(e => <span key={e.item}>
        <span className="grab-burst" aria-hidden="true" />
        <span className="grab-score-pop font-num">{e.bonusTicks ? t.bonus : fill(t.reward, { n: e.points })}</span>
      </span>)}
    </button>
    </div>
    </div>
    {paused && !snap.over && <p className="grab-paused" role="status">{t.paused}</p>}
  </section>;
}

"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { copy } from "@/copy";
import { fill } from "@/components/customer/format";
import type { TierView } from "@/components/game/types";
import { sound } from "@/components/game/sound";
import { haptic, useMotionPrefs } from "@/lib/motion/react";
import { createGrabGame, FIELD_WIDTH, FIELD_HEIGHT, OVEN_X, OVEN_Y, type GrabEvent, type GrabItem } from "@/lib/grab";
import { BoardPaper } from "@/components/m3/M3Art";
import { GrabArt, GrabFace } from "./GrabArt";
import { createGrabClock, elapsedTick } from "./grabClock";
import "./grab.css";

const t = copy.customer.grab;
export interface GrabProgress { launches: number[]; score: number; elapsedMs: number; endTick: number }
interface Props {
  seed: string; tiers: TierView[]; initialLaunches?: number[]; initialElapsedMs?: number;
  soundOn: boolean; reduced: boolean; paused: boolean;
  onProgress: (p: GrabProgress) => void; onOver: (p: GrabProgress) => void; onShowResult?: () => void;
}
type ScorePop = Extract<GrabEvent, { type: "score" }>;

export function GrabBoard({ seed, tiers, initialLaunches = [], initialElapsedMs = 0, soundOn, reduced, paused, onProgress, onOver, onShowResult }: Props) {
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
  const [ovenTick, setOvenTick] = useState(-100);
  const raf = useRef<number | null>(null);
  const reported = useRef(false);
  const active = useRef(false);
  const lastFeedback = useRef(-1);

  const publish = useCallback((events: GrabEvent[], render = true) => {
    const state = game.state();
    const elapsedMs = state.tick * 1000 / 60;
    const progress = { launches: [...launches.current], score: state.score, elapsedMs, endTick: state.tick };
    onProgress(progress);
    if (render) {
      setSnap(state);
      const scores = events.filter((e): e is ScorePop => e.type === "score");
      setPops(old => {
        const keep = old.filter(e => state.tick - e.tick < 48);
        return !scores.length && keep.length === old.length ? old : [...keep, ...scores];
      });
      const refill = [...events].reverse().find(e => e.type === "refill");
      if (refill) setOvenTick(refill.tick);
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
  }, [game, onOver, onProgress, quiet, soundOn]);

  useEffect(() => {
    const stop = () => {
      active.current = false;
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
      const elapsed = clock.pause(performance.now());
      publish(game.step(elapsedTick(elapsed)));
    };
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
  }, [clock, game, paused, publish]);

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
      if (game.launch(tick)) { launches.current.push(tick); if (soundOn) sound.drop(); }
    }
    publish(events);
  };
  const item = (bread: GrabItem, held = false) => <span key={bread.id} className={`grab-item${held ? " grab-held" : snap.tick - bread.age > 0 && bread.age < 18 ? " grab-refill" : ""}`} data-kind={bread.kind} data-stage={bread.stage}
    style={{ left: `${bread.x / FIELD_WIDTH * 100}%`, top: `${bread.y / FIELD_HEIGHT * 100}%`, width: `${bread.radius * 2 / FIELD_WIDTH * 100}%`, height: `${bread.radius * 2 / FIELD_HEIGHT * 100}%`, "--from-x": `${(OVEN_X - bread.x) / (bread.radius * 2) * 100}%`, "--from-y": `${(OVEN_Y - bread.y) / (bread.radius * 2) * 100}%` } as CSSProperties}>
    <GrabFace item={bread} tiers={tiers} />
  </span>;
  return <section className={`grab-play${quiet ? " grab-quiet" : ""}${paused || hidden || snap.over ? " grab-still" : ""}`}>
    <div className="grab-hud">
      <p>{t.timer}<b className="font-num" data-testid="grab-timer">{Math.ceil(snap.timeLeft / 60)}</b></p>
      <p>{t.score}<b className="font-num" data-testid="grab-score">{snap.score}</b></p>
    </div>
    <div className="grab-bakery" aria-hidden="true" />
    <div className="grab-field-space">
    <div className="grab-field-frame" style={{ aspectRatio: `${FIELD_WIDTH} / ${FIELD_HEIGHT}`, "--grab-aspect": FIELD_WIDTH / FIELD_HEIGHT } as CSSProperties}>
    <GrabArt name="bunny" className="grab-bunny" />
    <button type="button" className="grab-board"
      onPointerDown={e => { if (e.isPrimary && e.button === 0) launch(); }}
      // Keyboard/assistive activation has no preceding pointerdown. Pointer-generated
      // clicks are ignored even if a long press outlasts an entire grab.
      onClick={e => { if (e.detail === 0) launch(); }} aria-label={t.boardLabel} data-testid="grab-board" data-tick={snap.tick} data-phase={snap.claw.phase} data-launches={snap.launchesAccepted}>
      <BoardPaper />
      <GrabArt name="oven" className={`grab-oven${snap.tick - ovenTick < 30 ? " grab-oven-warm" : ""}`} />
      {snap.items.map(bread => item(bread))}
      <span className="grab-arm" style={{ transform: `rotate(${-snap.claw.angle}deg)`, height: `${snap.claw.length / FIELD_HEIGHT * 100}%` }}>
        <GrabArt name="arm" className="grab-arm-segment" />
        <GrabArt name="tongs" className="grab-tongs" />
      </span>
      {snap.claw.held && item(snap.claw.held, true)}
      {pops.map(e => <span key={e.item} className="grab-score-pop font-num">
        {e.bonusTicks ? t.bonus : fill(t.reward, { n: e.points })}
      </span>)}
    </button>
    </div>
    </div>
    {paused && !snap.over && <p className="grab-paused" role="status">{t.paused}</p>}
  </section>;
}

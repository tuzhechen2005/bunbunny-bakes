"use client";

import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from "react";
import { copy } from "@/copy";
import { fill } from "@/components/customer/format";
import type { TierView } from "@/components/game/types";
import { sound } from "@/components/game/sound";
import { haptic, useMotionPrefs } from "@/lib/motion/react";
import { createGrabGame, grabLevelRules, FIELD_WIDTH, FIELD_HEIGHT, OVEN_X, OVEN_Y, type GrabEvent, type GrabItem, type GrabOrder, type GrabState } from "@/lib/grab";
import { photoUrl } from "@/lib/photo";
import { gamePrimary } from "@/components/game/GameChrome";
import { GrabArt, GrabFace } from "./GrabArt";
import { createGrabClock, elapsedTick } from "./grabClock";
import { grabPresentationKey, isGrabRefilling } from "./grabPresentation";
import "./grab.css";

const t = copy.customer.grab;
export interface GrabProgress {
  launches: number[]; score: number; elapsedMs: number; endTick: number;
  /** The run's last level, its level score/target and orders completed (shown on the result before the server answers). */
  level?: number; levelScore?: number; levelTarget?: number; completedOrders?: number;
}
export interface GrabBoardHandle { pause: () => void }
interface Props {
  ref?: Ref<GrabBoardHandle>;
  seed: string; tiers: TierView[]; initialLaunches?: number[]; initialElapsedMs?: number;
  soundOn: boolean; reduced: boolean; paused: boolean;
  onProgress: (p: GrabProgress) => void; onOver: (p: GrabProgress) => void; onShowResult?: () => void;
}
type ScorePop = Extract<GrabEvent, { type: "score" }>;
type Blast = Extract<GrabEvent, { type: "explode" }>;
type OrderDone = Extract<GrabEvent, { type: "order" }> & { prev: GrabOrder };
type PlaceItem = (id: number, el: HTMLElement | null) => void;
/** A blast stays on screen this many ticks (the boom, flying breads and the −5 秒 tag). */
const BLAST_TICKS = 54;

const GrabSprite = memo(function GrabSprite({ bread, tiers, held = false, refilling = false, place }: {
  bread: GrabItem; tiers: TierView[]; held?: boolean; refilling?: boolean; place?: PlaceItem;
}) {
  const dir = (bread.velocityX ?? 0) < 0 ? "left" : "right";
  return <span ref={el => { if (!held) place?.(bread.id, el); }} className={`grab-item${held ? " grab-held" : refilling ? " grab-refill" : ""}`}
    data-kind={bread.kind} data-stage={bread.stage} data-golden={bread.golden ? "" : undefined} data-mouse={bread.mouse ? "" : undefined} data-dir={bread.mouse ? dir : undefined}
    style={{ left: `${(held ? 0 : bread.x) / FIELD_WIDTH * 100}%`, top: `${(held ? 0 : bread.y) / FIELD_HEIGHT * 100}%`, width: `${bread.radius * 2 / FIELD_WIDTH * 100}%`, height: `${bread.radius * 2 / FIELD_HEIGHT * 100}%`, "--rot": `${(bread.id * 37) % 13 - 6}deg`, "--from-x": `${(OVEN_X - bread.x) / (bread.radius * 2) * 100}%`, "--from-y": `${(OVEN_Y - bread.y) / (bread.radius * 2) * 100}%` } as CSSProperties}>
    {bread.mouse && !held && <i className="grab-mouse" aria-hidden="true" />}
    <GrabFace item={bread} tiers={tiers} />
  </span>;
  // Positions are painted through refs (see `paint`), so motion never re-renders a sprite.
}, (a, b) => a.tiers === b.tiers && a.held === b.held && a.refilling === b.refilling && a.place === b.place &&
  a.bread.id === b.bread.id && a.bread.stage === b.bread.stage && a.bread.golden === b.bread.golden &&
  a.bread.mouse === b.bread.mouse && Math.sign(a.bread.velocityX ?? 0) === Math.sign(b.bread.velocityX ?? 0));

const Check = () => <svg viewBox="0 0 24 24" className="grab-check" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;

/** Which of the order's two slots are already delivered (duplicates fill in order). */
function delivered(order: GrabOrder): boolean[] {
  const left = [...order.remaining];
  return order.required.map(kind => { const i = left.indexOf(kind); if (i < 0) return true; left.splice(i, 1); return false; });
}

function OrderCard({ order, tiers, className = "", done = false, next = false, testId }: { order: GrabOrder; tiers: TierView[]; className?: string; done?: boolean; next?: boolean; testId?: string }) {
  const flags = delivered(order);
  return <div className={`grab-order-card ${className}`} data-testid={testId} data-next={next ? "" : undefined} data-remaining={done ? 0 : order.remaining.length} aria-label={t.order}>
    {order.required.map((kind, i) => {
      const url = tiers[kind]?.imageUrl;
      const ok = done || flags[i];
      return <span key={i} className={`grab-order-slot${ok ? " grab-order-ok" : ""}`} data-done={ok ? "1" : "0"}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url ? photoUrl(url, 128) : "/brand/grab/bread.svg"} alt="" draggable={false} />
        {ok && <Check />}
      </span>;
    })}
    <b className="grab-order-reward font-num">{fill(t.reward, { n: order.reward })}</b>
  </div>;
}

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
  const [blasts, setBlasts] = useState<Blast[]>([]);
  const liveBlasts = useRef<Blast[]>([]);
  const [orderDones, setOrderDones] = useState<OrderDone[]>([]);
  const liveOrderDones = useRef<OrderDone[]>([]);
  const lastOrder = useRef<GrabOrder | null>(null);
  // Level clear: the run is held on the interstitial until the player taps through.
  const [interlude, setInterlude] = useState<{ cleared: number; target: number } | null>(null);
  const halted = paused || interlude !== null;
  const items = useRef(new Map<number, { el: HTMLElement; x: number; y: number }>());
  const place = useCallback<PlaceItem>((id, el) => {
    if (el) items.current.set(id, { el, x: NaN, y: NaN }); else items.current.delete(id);
  }, []);
  const tag = useRef<HTMLSpanElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const shaken = useRef(-1);
  // A short board shake per new blast, via WAAPI so no element remounts.
  useEffect(() => {
    const last = blasts.at(-1);
    if (!last || last.item.id === shaken.current) return;
    shaken.current = last.item.id;
    if (quiet) return;
    frame.current?.animate?.([{ transform: "translate(0,0)" }, { transform: "translate(-6px,3px)" }, { transform: "translate(5px,-4px)" },
      { transform: "translate(-3px,2px)" }, { transform: "translate(0,0)" }], { duration: 360, easing: "ease-out" });
  }, [blasts, quiet]);
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
    for (const item of state.items) {
      const slot = items.current.get(item.id);
      if (slot && (slot.x !== item.x || slot.y !== item.y)) {
        slot.x = item.x; slot.y = item.y;
        slot.el.style.left = `${item.x / FIELD_WIDTH * 100}%`; slot.el.style.top = `${item.y / FIELD_HEIGHT * 100}%`;
      }
    }
    const held = state.claw.held;
    if (tag.current && held) {
      // The contact label rides under the bread, kept inside the board.
      const x = Math.min(.84, Math.max(.16, state.claw.x / FIELD_WIDTH)), y = Math.min(1034, state.claw.y + held.radius * .6 + 8);
      tag.current.style.transform = `translate(${x * 100}%, ${y / FIELD_HEIGHT * 100}%)`;
    }
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
    const progress = { launches: launches.current, score: state.score, elapsedMs, endTick: state.tick, level: state.level, levelScore: state.levelScore, levelTarget: state.levelTarget, completedOrders: state.completedOrders };
    onProgress(progress);
    if (render) {
      paint(state);
      const scores = events.filter((e): e is ScorePop => e.type === "score");
      livePops.current = [...livePops.current.filter(e => state.tick - e.tick < 48), ...scores]
        .filter(e => state.tick - e.tick < 48).slice(-4);
      for (const event of events) if (event.type === "refill") ovenUntil.current = event.tick + 30;
      const dones = events.flatMap((e): OrderDone[] => e.type === "order" ? [{ ...e, prev: { ...(lastOrder.current ?? e.order), remaining: [] } }] : []);
      lastOrder.current = state.order;
      liveOrderDones.current = [...liveOrderDones.current, ...dones].filter(e => state.tick - e.tick < 54);
      const cleared = events.find(e => e.type === "level");
      if (cleared) {
        // Hold the run right at the event; the interstitial resumes it.
        active.current = false;
        if (raf.current !== null) cancelAnimationFrame(raf.current);
        raf.current = null;
        clock.pause(performance.now());
        setInterlude({ cleared: cleared.level - 1, target: cleared.target });
        if (soundOn) sound.merge(3);
      }
      const booms = events.filter((e): e is Blast => e.type === "explode");
      liveBlasts.current = [...liveBlasts.current, ...booms].filter(e => state.tick - e.tick < BLAST_TICKS);
      const warm = state.tick < ovenUntil.current;
      const key = `${grabPresentationKey(state)}|${warm}|${livePops.current.map(e => e.item).join(",")}|${liveBlasts.current.map(e => e.item.id).join(",")}|${liveOrderDones.current.map(e => e.completed).join(",")}`;
      if (key !== presentation.current) {
        presentation.current = key;
        setSnap(state);
        setPops(livePops.current);
        setOvenWarm(warm);
        setBlasts(liveBlasts.current);
        setOrderDones(liveOrderDones.current);
      }
      if (booms.length) {
        if (soundOn) sound.boom();
        if (!quiet) haptic(40);
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
  }, [clock, game, onOver, onProgress, paint, quiet, soundOn]);

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
      if (halted || document.hidden || game.over) return;
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
  }, [clock, game, halted, publish, stop]);

  const launch = () => {
    if (game.over) { onShowResult?.(); return; }
    if (halted || document.hidden) return;
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
  const duration = grabLevelRules(snap.level).duration;
  const pending = snap.pendingResult;
  const heldNow = snap.claw.held;
  const nextOrder = orderDones.length > 0;
  return <section className={`grab-play${quiet ? " grab-quiet" : ""}${halted || hidden || snap.over ? " grab-still" : ""}${seconds <= 10 && !snap.over ? " grab-hurry" : ""}`}>
    <div className="grab-hud">
      <p className="grab-timer-wrap">{t.timer}<b className="font-num" data-testid="grab-timer">{seconds}</b>
        {blasts.map(e => <span key={e.item.id} className="grab-penalty font-num" data-testid="grab-penalty">{fill(t.penalty, { n: e.penaltyTicks / 60 })}</span>)}</p>
      <div className="grab-level" data-testid="grab-level" data-level={snap.level}>
        <span className="grab-level-name font-display">{fill(t.level, { n: snap.level })}</span>
        <div className="grab-level-bar" role="progressbar" aria-label={t.target} aria-valuemin={0} aria-valuemax={snap.levelTarget} aria-valuenow={Math.min(snap.levelScore, snap.levelTarget)} data-testid="grab-target">
          <i style={{ transform: `scaleX(${Math.min(1, snap.levelScore / snap.levelTarget)})` }} /></div>
        <span className="grab-level-num font-num">{fill(t.progress, { have: Math.min(snap.levelScore, snap.levelTarget), need: snap.levelTarget })}</span>
      </div>
      <p>{t.score}<b key={snap.score} className={`font-num${snap.score ? " grab-bump" : ""}`} data-testid="grab-score">{snap.score}</b></p>
    </div>
    <div className="grab-timebar" aria-hidden="true"><i style={{ transform: `scaleX(${Math.min(1, Math.max(0, snap.timeLeft - 60) / duration)})` }} /></div>
    <div className="grab-bakery">
      <div className="grab-order" data-testid="grab-order-slot">
        {orderDones.slice(-1).map(e => <OrderCard key={`leave${e.completed}`} order={e.prev} tiers={tiers} done className="grab-order-leave" testId="grab-order-leaving" />)}
        <OrderCard key={snap.order.id} order={snap.order} tiers={tiers} className="grab-order-in" next={nextOrder} testId="grab-order" />
        {orderDones.slice(-1).map(e => <span key={`pop${e.completed}`} className="grab-order-pop font-num" data-testid="grab-order-pop">{fill(t.reward, { n: e.reward })}</span>)}
      </div>
      {snap.perfectChain > 0 && <p key={snap.perfectChain} className="grab-chain" data-testid="grab-chain" data-chain={snap.perfectChain}>
        <span>{fill(t.chain, { n: snap.perfectChain })}</span>
        {snap.nextPerfectBonusPercent > 0 && <b className="font-num">{fill(t.chainBonus, { n: snap.nextPerfectBonusPercent })}</b>}
      </p>}
    </div>
    <div className="grab-field-space">
    <div ref={frame} className="grab-field-frame" style={{ aspectRatio: `${FIELD_WIDTH} / ${FIELD_HEIGHT}`, "--grab-aspect": FIELD_WIDTH / FIELD_HEIGHT } as CSSProperties}>
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
      {snap.items.map(bread => <GrabSprite key={bread.id} bread={bread} tiers={tiers} place={place} refilling={isGrabRefilling(bread, snap.tick)} />)}
      <span ref={tipShadow} className="grab-tip-shadow" aria-hidden="true" />
      <span ref={arm} className="grab-arm">
        <span ref={armSegment} className="grab-arm-scale"><GrabArt name="arm" className="grab-arm-segment" /></span>
        <span ref={tip} className="grab-tip"><GrabArt name="tongs" className={`grab-tongs${heldNow && heldNow.weight >= 7 ? " grab-strain" : ""}`} /></span>
      </span>
      <span ref={heldPosition} className="grab-held-position">
        {heldNow && <GrabSprite key={heldNow.id} bread={heldNow} tiers={tiers} held />}
      </span>
      {pending && heldNow && (pending.stage !== "none" || pending.points > 0) && <span ref={tag} key={pending.item} className="grab-tag-pos" aria-hidden="true">
        <span className={`grab-tag grab-tag-${pending.stage}`} data-testid="grab-contact" data-stage={pending.stage}>
          {pending.stage !== "none" && <span className="font-display">{t.stage[pending.stage]}</span>}
          <b className="font-num">{fill(t.reward, { n: pending.points })}</b>
          {heldNow.mouse && <em className="font-num" data-testid="grab-mouse-mult">{t.mouseMult}</em>}
        </span>
      </span>}
      {blasts.map(e => <span key={e.item.id} className="grab-blast" data-testid="grab-blast"
        style={{ left: `${e.item.x / FIELD_WIDTH * 100}%`, top: `${e.item.y / FIELD_HEIGHT * 100}%` } as CSSProperties}>
        {e.destroyed.map((d, i) => {
          // Each destroyed piece flies away from the bomb and fades.
          const dx = d.x - e.item.x, dy = d.y - e.item.y, n = Math.max(1, Math.hypot(dx, dy));
          return <span key={d.id} className="grab-debris" style={{ left: `${dx / FIELD_WIDTH * 100}%`, top: `${dy / FIELD_HEIGHT * 100}%`,
            width: `${d.radius * 2 / FIELD_WIDTH * 100}%`, height: `${d.radius * 2 / FIELD_HEIGHT * 100}%`,
            "--dx": `${dx / n * 140}%`, "--dy": `${dy / n * 140 - 60}%`, "--spin": `${(i % 2 ? 1 : -1) * (120 + i * 40)}deg` } as CSSProperties}>
            <GrabFace item={d} tiers={tiers} /></span>;
        })}
        <GrabArt name="boom" className="grab-boom" />
      </span>)}
      {pops.map(e => <span key={e.item}>
        <span className="grab-burst" aria-hidden="true" />
        <span className="grab-score-pop font-num">{e.bonusTicks ? t.bonus : fill(t.reward, { n: e.points })}</span>
      </span>)}
    </button>
    {interlude && !snap.over && <div className="grab-interlude" role="dialog" aria-label={fill(t.levelClear, { n: interlude.cleared })} data-testid="grab-level-clear">
      <p className="grab-interlude-title font-display">{fill(t.levelClear, { n: interlude.cleared })}</p>
      <p className="grab-interlude-target font-num">{fill(t.nextTarget, { n: interlude.target })}</p>
      <button type="button" autoFocus className={`${gamePrimary} grab-interlude-next`} onClick={() => setInterlude(null)} data-testid="grab-level-next">{t.nextLevel}</button>
    </div>}
    </div>
    </div>
    {paused && !snap.over && <p className="grab-paused" role="status">{t.paused}</p>}
  </section>;
}

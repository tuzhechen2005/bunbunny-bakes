"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { fill } from "@/components/customer/format";
import { sound } from "@/components/game/sound";
import type { TierView } from "@/components/game/types";
import { copy } from "@/copy";
import { BIG_BASE, ROLL_BASE, MIN_MOVE_GAP_MS, createM3Game, legalM3Moves, tierOf, type M3Cell, type M3FailureGap, type M3Move, type M3Swap, type M3Level } from "@/lib/m3";
import { motionHealth } from "@/lib/motion/fps";
import { haptic, useMotionPrefs } from "@/lib/motion/react";
import { adjacent, animationQueue, paceQueue, sameCell, swipeDirection, swipeTarget, type AnimationFrame, type SwipeDirection } from "./m3Animation";
import { BreadFace, PieceFace } from "./M3Art";
import { M3KindHint, M3SpecialTip } from "./M3SpecialTip";
import "./m3.css";

const t = copy.customer.m3;
export interface M3Progress { moves: M3Move[]; score: number; gap?: M3FailureGap | null }
interface Props {
  level?: number; rules?: M3Level;
  tiers: TierView[]; seed: string; initialMoves?: M3Move[]; soundOn: boolean; reduced: boolean;
  onProgress: (p: M3Progress) => void; onOver: (p: M3Progress) => void; onShowResult?: () => void;
}

/** One board cell. Memoised: an animation frame re-renders only the cells it moves. */
const Cell = memo(function Cell({ r, c, code, tier, effect, dx, dy, ms, hinted, pressed, busy, onTap }: {
  r: number; c: number; code: number; tier: TierView | undefined; effect: string; dx: number; dy: number; ms: number;
  hinted: boolean; pressed: boolean; busy: boolean; onTap: (r: number, c: number) => void;
}) {
  return <div className={`m3-cell${(r + c) % 2 ? " m3-cell-alt" : ""}`} style={{ left: `${c * 12.5}%`, top: `${r * 12.5}%` }}>
    {code >= 0 && tier && <span className={`m3-piece ${effect} ${hinted ? "m3-hint" : ""}`} style={{ "--dx": `${dx}%`, "--dy": `${dy}%`, "--duration": `${ms}ms` } as CSSProperties}>
      <PieceFace tier={tier} kind={code >= ROLL_BASE ? code >= BIG_BASE ? "big" : "roll" : undefined} />
    </span>}
    <button type="button" className="m3-target" data-cell={`${r},${c}`} data-testid={`m3-cell-${r}-${c}`} data-code={code} aria-pressed={pressed} disabled={busy}
      aria-label={fill(t.tileLabel, { r: String(r + 1), c: String(c + 1), name: tier?.name ?? "", special: code >= BIG_BASE ? t.big : code >= ROLL_BASE ? t.roll : "" })}
      onClick={() => onTap(r, c)} />
  </div>;
});

export function M3Board({ level, rules, tiers, seed, initialMoves = [], soundOn, reduced, onProgress, onOver, onShowResult }: Props) {
  const { degraded } = useMotionPrefs();
  const [game] = useState(() => {
    const g = createM3Game({ seed, tiers, ...rules });
    initialMoves.forEach(m => g.swap(m.a, m.b));
    return g;
  });
  const moves = useRef([...initialMoves]);
  const clock = useRef<{ base: number; start: number } | null>(null);
  const [snap, setSnap] = useState(() => game.state());
  const [frame, setFrame] = useState<AnimationFrame | null>(null);
  const [invalid, setInvalid] = useState<M3Swap | null>(null);
  const [selected, setSelected] = useState<M3Cell | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [hint, setHint] = useState<M3Swap | null>(null);
  const [activity, setActivity] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const board = useRef<HTMLDivElement>(null);
  const reported = useRef(false);
  const quiet = reduced || degraded;

  // Consecutive frames can reuse an animation name. Restart the CSS animation while
  // keeping BreadFace mounted, including its failed-image fallback state.
  useLayoutEffect(() => {
    board.current?.querySelectorAll<HTMLElement>(".m3-piece").forEach(piece => {
      piece.getAnimations().forEach(animation => { animation.currentTime = 0; });
    });
  }, [frame, invalid]);

  useEffect(() => {
    clock.current = { base: moves.current.at(-1)?.at ?? 0, start: Date.now() };
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, []);
  useEffect(() => {
    if (!snap.over || reported.current) return;
    reported.current = true;
    onOver({ moves: [...moves.current], score: game.score, gap: game.state().failureGap });
  }, [snap.over, game, onOver]);
  // Monitor only active transitions; no idle animation loop.
  useEffect(() => {
    if (!busy || quiet) return;
    let raf = 0;
    motionHealth.restart();
    const tick = (now: number) => { motionHealth.frame(now); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [busy, quiet]);
  useEffect(() => {
    if (busy || snap.over || quiet) return;
    const id = setTimeout(() => setHint(legalM3Moves(snap)[0] ?? null), 5000);
    return () => clearTimeout(id);
  }, [busy, snap, quiet, activity]);

  const attempt = useCallback((a: M3Cell, b: M3Cell) => {
    if (locked.current || game.over || !adjacent(a, b)) return;
    locked.current = true;
    setBusy(true); setHint(null); setSelected(null); setActivity(n => n + 1);
    const before = game.state();
    const events = game.swap(a, b);
    const unlock = () => { locked.current = false; setBusy(false); };
    if (!events) {
      setInvalid({ a, b });
      timer.current = setTimeout(() => { setInvalid(null); unlock(); }, quiet ? 160 : 360);
      return;
    }
    const now = Date.now();
    clock.current ??= { base: (moves.current.at(-1)?.at ?? -MIN_MOVE_GAP_MS) + MIN_MOVE_GAP_MS, start: now };
    const at = Math.max(clock.current.base + now - clock.current.start, (moves.current.at(-1)?.at ?? -MIN_MOVE_GAP_MS) + MIN_MOVE_GAP_MS);
    moves.current.push({ a, b, at });
    // Persist the accepted move before playback so leaving mid-cascade loses no moves.
    onProgress({ moves: [...moves.current], score: game.score });
    if (soundOn) sound.drop();
    if (!quiet) haptic(10);
    const queue = paceQueue(animationQueue(before, events));
    let i = 0;
    const next = () => {
      const f = queue[i++];
      if (!f) { setFrame(null); setSnap(game.state()); unlock(); return; }
      setFrame(f);
      if (soundOn && f.event.type === "match") sound.merge(f.event.chain);
      if (soundOn && f.event.type === "order" && f.event.action === "complete") sound.big();
      timer.current = setTimeout(next, quiet ? Math.min(f.ms, 80) : f.ms);
    };
    next();
  }, [game, onProgress, quiet, soundOn]);

  // Native non-passive touchmove lets vertical AND horizontal board drags cancel scrolling.
  useEffect(() => {
    const el = board.current;
    if (!el) return;
    let gesture: { a: M3Cell; x: number; y: number; direction: SwipeDirection | null; dragged: boolean; fired: boolean; dx: number; dy: number } | null = null;
    let suppressClickUntil = 0;
    const cancel = () => {
      gesture = null;
      setSelected(null);
      suppressClickUntil = Date.now() + 500;
    };
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) { cancel(); return; }
      if (locked.current || game.over) { gesture = null; return; }
      const target = (e.target as Element).closest<HTMLElement>("[data-cell]");
      if (!target) return;
      const [r, c] = target.dataset.cell!.split(",").map(Number);
      gesture = { a: { r, c }, x: e.touches[0].clientX, y: e.touches[0].clientY, direction: null, dragged: false, fired: false, dx: 0, dy: 0 };
      setHint(null); setActivity(n => n + 1);
    };
    // Direction is decided only once the finger has clearly travelled along one axis, and the
    // swap fires as soon as it crosses ~40% of a cell — jitter and taps never swap.
    const cellSize = () => (el.getBoundingClientRect?.().width || 360) / 8;
    const move = (e: TouchEvent) => {
      if (!gesture) return;
      if (e.touches.length !== 1) { cancel(); return; }
      e.preventDefault();
      gesture.dx = e.touches[0].clientX - gesture.x; gesture.dy = e.touches[0].clientY - gesture.y;
      const ax = Math.abs(gesture.dx), ay = Math.abs(gesture.dy), major = Math.max(ax, ay), minor = Math.min(ax, ay);
      if (!gesture.direction && major >= Math.max(8, cellSize() * .18) && major >= minor * 1.5) {
        gesture.direction = swipeDirection(gesture.dx, gesture.dy);
        setSelected(null);
        gesture.dragged = true;
      }
      if (gesture.direction && !gesture.fired) {
        const along = gesture.direction === "left" || gesture.direction === "right" ? ax : ay;
        if (along >= cellSize() * .4) {
          gesture.fired = true;
          suppressClickUntil = Date.now() + 500;
          const b = swipeTarget(gesture.a, gesture.direction);
          if (b) attempt(gesture.a, b);
        }
      }
    };
    const end = () => {
      // A drag that never committed (too short or too diagonal) is neither a swap nor a tap.
      if (gesture?.dragged || (gesture && Math.max(Math.abs(gesture.dx), Math.abs(gesture.dy)) >= 10)) suppressClickUntil = Date.now() + 400;
      gesture = null;
    };
    const click = (e: MouseEvent) => { if (Date.now() < suppressClickUntil) { e.preventDefault(); e.stopPropagation(); } };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end); el.addEventListener("touchcancel", cancel);
    el.addEventListener("click", click, true);
    return () => {
      el.removeEventListener("touchstart", start); el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end); el.removeEventListener("touchcancel", cancel); el.removeEventListener("click", click, true);
    };
  }, [attempt, game]);

  const selectedRef = useRef(selected);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  const tap = useCallback((r: number, c: number) => {
    if (locked.current) return;
    if (game.over) { onShowResult?.(); return; }
    const p = { r, c }, sel = selectedRef.current;
    setHint(null); setActivity(n => n + 1);
    if (sel && adjacent(sel, p)) attempt(sel, p);
    else setSelected(sameCell(sel, p) ? null : p);
  }, [attempt, game, onShowResult]);

  const event = frame?.event;
  const view = frame ? ["refill", "special", "order", "shuffle", "over"].includes(frame.event.type) ? frame.after : frame.before : snap;
  const display = frame?.after ?? snap;
  return <div className={`m3-play ${quiet ? "m3-quiet" : ""}`} data-testid="m3-play" data-reduced={reduced} data-degraded={degraded}>
    <div className="m3-status">
      <p className="m3-stat">{t.movesLeft}<b className={`font-num${display.movesLeft <= 3 && !display.over ? " m3-low" : ""}`} data-testid="m3-moves">{display.movesLeft}</b></p>
      {level && <p className="m3-level-pill font-display" data-testid="m3-level">{fill(t.level, { n: String(level) })}</p>}
      <p className="m3-stat m3-stat-end">{t.score}<b className="font-num"><span key={display.score} className={display.score ? "m3-bump" : ""} data-testid="m3-score">{display.score}</span>{rules && <span className="m3-target-num"> / {rules.target}</span>}</b></p>
      {rules && <progress className="m3-level-progress" value={Math.min(display.score, rules.target)} max={rules.target} aria-label={t.target} data-testid="m3-target" />}
    </div>
    <div className="m3-orders" data-testid="m3-orders" aria-label={t.orders}>
      {view.orders.map((order, i) => <div key={i} className={`m3-order ${order.have >= order.need ? "m3-order-full " : ""}${event?.type === "order" && event.index === i && event.action === "complete" ? "m3-order-done" : ""}`} data-testid={`m3-order-${i}`} data-have={order.have} data-tier={order.tier}>
        <span className="m3-order-photo"><BreadFace key={tiers[order.tier].id} tier={tiers[order.tier]} /></span>
        <div className="m3-order-body">
          <div><span className="font-num" data-testid={`m3-order-progress-${i}`}>{fill(t.progress, { have: String(order.have), need: String(order.need) })}</span><b className="font-num">{fill(t.reward, { n: String(order.points) })}</b></div>
          <progress value={order.have} max={order.need} aria-label={tiers[order.tier].name ?? t.orders} />
        </div>
      </div>)}
    </div>
    <div className="m3-board-wrap">
      <M3SpecialTip board={view.board} />
      {level && rules && <M3KindHint level={level} tierCount={rules.tierCount} started={busy || snap.movesLeft < rules.moves} />}
      <div ref={board} className={`m3-board ${event?.type === "shuffle" ? "m3-shuffle" : ""}`} role="group" aria-label={t.boardLabel} aria-busy={busy} data-testid="m3-board">
        {view.board.flatMap((row, r) => row.map((code, c) => {
          const p = { r, c };
          let dx = 0, dy = 0, effect = "";
          const swap = invalid ?? (event?.type === "swap" ? event : null);
          if (swap && (sameCell(swap.a, p) || sameCell(swap.b, p))) {
            const to = sameCell(swap.a, p) ? swap.b : swap.a;
            dx = (to.c - c) * 100; dy = (to.r - r) * 100; effect = invalid ? "m3-invalid" : "m3-travel";
          }
          if (event?.type === "fall") {
            const tile = event.tiles.find(tile => sameCell(tile.from, p));
            if (tile) { dy = (tile.to.r - r) * 100; effect = "m3-travel"; }
          }
          if (event?.type === "refill" && event.tiles.some(tile => sameCell(tile, p))) { dy = -(r + 1) * 100; effect = "m3-refill"; }
          if (event?.type === "match" && event.cells.some(cell => sameCell(cell, p))) effect = "m3-pop";
          if (event?.type === "special" && sameCell(event.cell, p)) effect = "m3-flash";
          return <Cell key={`${r}-${c}`} r={r} c={c} code={code} tier={tiers[tierOf(code)]} effect={effect} dx={dx} dy={dy}
            ms={invalid ? 360 : frame?.ms ?? 180} hinted={!quiet && !!hint && (sameCell(hint.a, p) || sameCell(hint.b, p))}
            pressed={sameCell(selected, p)} busy={busy} onTap={tap} />;
        }))}
      </div>
    </div>
  </div>;
}

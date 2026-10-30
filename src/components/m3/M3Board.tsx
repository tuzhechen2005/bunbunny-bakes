"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { fill } from "@/components/customer/format";
import { sound } from "@/components/game/sound";
import type { TierView } from "@/components/game/types";
import { copy } from "@/copy";
import { BIG_BASE, ROLL_BASE, MIN_MOVE_GAP_MS, createM3Game, legalM3Moves, tierOf, type M3Cell, type M3Move, type M3Swap } from "@/lib/m3";
import { motionHealth } from "@/lib/motion/fps";
import { haptic, useMotionPrefs } from "@/lib/motion/react";
import { adjacent, animationQueue, sameCell, swipeDirection, swipeTarget, type AnimationFrame, type SwipeDirection } from "./m3Animation";
import { BoardPaper, BreadFace, SpecialMark } from "./M3Art";
import "./m3.css";

const t = copy.customer.m3;
export interface M3Progress { moves: M3Move[]; score: number }
interface Props {
  tiers: TierView[]; seed: string; initialMoves?: M3Move[]; soundOn: boolean; reduced: boolean;
  onProgress: (p: M3Progress) => void; onOver: (p: M3Progress) => void; onShowResult?: () => void;
}

export function M3Board({ tiers, seed, initialMoves = [], soundOn, reduced, onProgress, onOver, onShowResult }: Props) {
  const { degraded } = useMotionPrefs();
  const [game] = useState(() => {
    const g = createM3Game({ seed, tiers });
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

  useEffect(() => {
    clock.current = { base: moves.current.at(-1)?.at ?? 0, start: Date.now() };
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, []);
  useEffect(() => {
    if (!snap.over || reported.current) return;
    reported.current = true;
    onOver({ moves: [...moves.current], score: game.score });
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
    const queue = animationQueue(before, events);
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
    let gesture: { a: M3Cell; x: number; y: number; direction: SwipeDirection | null; dragged: boolean; dx: number; dy: number } | null = null;
    let suppressClickUntil = 0;
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1 || locked.current || game.over) { gesture = null; return; }
      const target = (e.target as Element).closest<HTMLElement>("[data-cell]");
      if (!target) return;
      const [r, c] = target.dataset.cell!.split(",").map(Number);
      gesture = { a: { r, c }, x: e.touches[0].clientX, y: e.touches[0].clientY, direction: null, dragged: false, dx: 0, dy: 0 };
      setHint(null); setActivity(n => n + 1);
    };
    const move = (e: TouchEvent) => {
      if (!gesture) return;
      if (e.touches.length !== 1) { gesture = null; return; }
      gesture.dx = e.touches[0].clientX - gesture.x; gesture.dy = e.touches[0].clientY - gesture.y;
      gesture.direction ??= swipeDirection(gesture.dx, gesture.dy);
      if (gesture.direction) { e.preventDefault(); gesture.dragged = true; }
    };
    const end = () => {
      if (gesture?.dragged && gesture.direction) {
        suppressClickUntil = Date.now() + 500;
        if (Math.max(Math.abs(gesture.dx), Math.abs(gesture.dy)) >= 12) {
          const b = swipeTarget(gesture.a, gesture.direction);
          if (b) attempt(gesture.a, b);
        }
      }
      gesture = null;
    };
    const cancel = () => { gesture = null; suppressClickUntil = Date.now() + 500; };
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

  const event = frame?.event;
  const view = frame ? ["refill", "special", "order", "shuffle", "over"].includes(frame.event.type) ? frame.after : frame.before : snap;
  const display = frame?.after ?? snap;
  return <div className={`m3-play ${quiet ? "m3-quiet" : ""}`} data-testid="m3-play" data-reduced={reduced} data-degraded={degraded}>
    <div className="m3-hud">
      <p>{t.movesLeft}<b className="font-num" data-testid="m3-moves">{display.movesLeft}</b></p>
      <p>{t.score}<b className="font-num" data-testid="m3-score">{display.score}</b></p>
    </div>
    <p className="m3-order-label">{t.orders}</p>
    <div className="m3-orders" data-testid="m3-orders">
      {view.orders.map((order, i) => <div key={i} className={`m3-order ${event?.type === "order" && event.index === i && event.action === "complete" ? "m3-order-done" : ""}`} data-testid={`m3-order-${i}`} data-have={order.have} data-tier={order.tier}>
        <div><span>{fill(t.orderNeed, { n: String(order.need) })}</span><b className="font-num">{fill(t.reward, { n: String(order.points) })}</b></div>
        <div><span className="m3-order-photo"><BreadFace key={tiers[order.tier].id} tier={tiers[order.tier]} /></span><span className="font-num" data-testid={`m3-order-progress-${i}`}>{fill(t.progress, { have: String(order.have), need: String(order.need) })}</span></div>
        <progress value={order.have} max={order.need} aria-label={tiers[order.tier].name ?? t.orders} />
      </div>)}
    </div>
    <div ref={board} className={`m3-board ${event?.type === "shuffle" ? "m3-shuffle" : ""}`} role="group" aria-label={t.boardLabel} aria-busy={busy} data-testid="m3-board">
      <BoardPaper />
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
        const tier = tiers[tierOf(code)];
        return <div key={`${r}-${c}`} className="m3-cell" style={{ left: `${c * 12.5}%`, top: `${r * 12.5}%` }}>
          {code >= 0 && <span key={frame ? `${frame.before.movesLeft}-${frame.index}` : "idle"} className={`m3-piece ${effect} ${!quiet && hint && (sameCell(hint.a, p) || sameCell(hint.b, p)) ? "m3-hint" : ""}`} style={{ "--dx": `${dx}%`, "--dy": `${dy}%`, "--duration": `${invalid ? 360 : frame?.ms ?? 180}ms` } as CSSProperties}>
            <BreadFace key={tier.id} tier={tier} />
            {code >= ROLL_BASE ? <SpecialMark kind={code >= BIG_BASE ? "big" : "roll"} /> : null}
          </span>}
          <button type="button" className="m3-target" data-cell={`${r},${c}`} data-testid={`m3-cell-${r}-${c}`} data-code={code} aria-pressed={sameCell(selected, p)} disabled={busy}
            aria-label={fill(t.tileLabel, { r: String(r + 1), c: String(c + 1), name: tier?.name ?? "", special: code >= BIG_BASE ? t.big : code >= ROLL_BASE ? t.roll : "" })}
            onClick={() => {
              if (locked.current) return;
              if (game.over) { onShowResult?.(); return; }
              setHint(null); setActivity(n => n + 1);
              if (selected && adjacent(selected, p)) attempt(selected, p);
              else setSelected(sameCell(selected, p) ? null : p);
            }} />
        </div>;
      }))}
    </div>
    <p className="m3-rules">{t.rules}</p>
  </div>;
}

"use client";

import { useEffect, useRef } from "react";
import { copy } from "@/copy";
import { haptic } from "@/lib/motion/react";
import { STEP_DT, type Session } from "./engine";
import { BoardRenderer, type Theme } from "./render";
import { sound } from "./sound";
import type { GameEvent } from "./types";

const t = copy.customer.game;
/** More steps than this in one frame are dropped (the game slows down instead of freezing the phone). */
const MAX_STEPS_PER_FRAME = 10;
const KEY_STEP = 0.035;

export interface HudState {
  score: number;
  /** Tier index of the piece after the one in hand. */
  next: number;
}

function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    wash: v("--c-wash"),
    paper: v("--c-paper"),
    ink: v("--c-ink"),
    line: v("--c-line"),
    red: v("--c-red"),
    numFont: getComputedStyle(document.body).getPropertyValue("--font-num-face").trim() || "Georgia, serif",
  };
}

/**
 * The board: canvas, aiming (touch drag / mouse / arrow keys) and the frame loop. The loop runs only
 * while the run is being played and the tab is visible (D105); it also finishes the last effects after
 * game over and then stops.
 */
export function Board({
  session,
  soundOn,
  reduced,
  onHud,
  onOver,
}: {
  session: Session;
  soundOn: boolean;
  reduced: boolean;
  onHud: (h: HudState) => void;
  onOver: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ soundOn, reduced, onHud, onOver });
  useEffect(() => {
    live.current = { soundOn, reduced, onHud, onOver };
  });
  const renderer = useRef<BoardRenderer | null>(null);

  useEffect(() => {
    const cv = canvas.current;
    const box = wrap.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !box || !ctx) return;
    const r = new BoardRenderer(ctx, session.tiers, readTheme(), session.dangerY, 1.5);
    r.reduced = live.current.reduced;
    renderer.current = r;

    // ---- size ----
    const fit = () => {
      const w = box.clientWidth;
      if (w === 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(w * 1.5 * dpr);
      r.resize(w, dpr);
      frame(true);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(box);

    // ---- aim ----
    let target = 0.5;
    let aimX = 0.5;
    let touching = false;
    const toWorld = (clientX: number) => {
      const b = cv.getBoundingClientRect();
      return Math.min(1, Math.max(0, (clientX - b.left) / b.width));
    };
    const emit = (ev: GameEvent) => {
      r.onEvent(ev);
      const L = live.current;
      if (ev.type === "drop") {
        if (L.soundOn) sound.drop();
      } else if (ev.type === "merge") {
        if (L.soundOn) (ev.big ? sound.big : () => sound.merge(ev.tier))();
        haptic(ev.big ? 40 : 12);
      } else if (ev.type === "over") {
        if (L.soundOn) sound.over();
      }
    };
    let lastHud = { score: -1, next: -1 };
    const hud = () => {
      const h = { score: session.score, next: session.upcoming() };
      if (h.score !== lastHud.score || h.next !== lastHud.next) {
        lastHud = h;
        live.current.onHud(h);
      }
    };
    const doDrop = (x: number) => {
      if (session.over) return;
      const evs = session.drop(x);
      if (evs) {
        box.dataset.drops = String(session.drops.length);
        evs.forEach(emit);
        hud();
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      touching = true;
      target = toWorld(e.touches[0].clientX);
      aimX = target;
      e.preventDefault();
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!touching) return;
      target = toWorld(e.touches[0].clientX);
      e.preventDefault();
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!touching) return;
      touching = false;
      const x = e.changedTouches[0] ? toWorld(e.changedTouches[0].clientX) : target;
      e.preventDefault();
      doDrop(x);
    };
    const onTouchCancel = () => {
      touching = false;
    };
    const onMouseMove = (e: MouseEvent) => {
      target = toWorld(e.clientX);
    };
    const onClick = (e: MouseEvent) => {
      doDrop(toWorld(e.clientX));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") target = Math.max(0, target - KEY_STEP);
      else if (e.key === "ArrowRight") target = Math.min(1, target + KEY_STEP);
      else if (e.key === " " || e.key === "Enter") doDrop(target);
      else return;
      e.preventDefault();
    };
    cv.addEventListener("touchstart", onTouchStart, { passive: false });
    cv.addEventListener("touchmove", onTouchMove, { passive: false });
    cv.addEventListener("touchend", onTouchEnd, { passive: false });
    cv.addEventListener("touchcancel", onTouchCancel);
    cv.addEventListener("mousemove", onMouseMove);
    cv.addEventListener("click", onClick);
    cv.addEventListener("keydown", onKey);

    // ---- loop ----
    let raf = 0;
    let last: number | null = null;
    let acc = 0;
    let finished = false;
    const frame = (still = false) => {
      const now = performance.now();
      const dt = last === null || still ? 0 : Math.min(0.05, (now - last) / 1000);
      last = now;
      r.reduced = live.current.reduced;
      aimX += (target - aimX) * (1 - Math.exp(-dt * 38));
      if (!session.over) {
        acc += dt;
        let n = Math.floor(acc / STEP_DT);
        acc -= n * STEP_DT;
        if (n > MAX_STEPS_PER_FRAME) n = MAX_STEPS_PER_FRAME;
        if (n > 0) {
          for (const ev of session.advance(n)) {
            if (ev.type === "merge" || ev.type === "over") emit(ev);
          }
          hud();
        }
      }
      const over = session.over;
      r.draw(
        session.bodies,
        { x: aimX, tier: session.current(), cooled: session.cooled, visible: !over },
        dt,
        now,
      );
      if (over && !finished) {
        finished = true;
        hud();
        live.current.onOver();
      }
      if (over && !r.animating) return;
      if (!still) raf = requestAnimationFrame(() => frame());
    };
    const start = () => {
      cancelAnimationFrame(raf);
      last = null;
      raf = requestAnimationFrame(() => frame());
    };
    const onVis = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else if (!(session.over && finished && !r.animating)) start();
    };
    document.addEventListener("visibilitychange", onVis);
    hud();
    fit();
    start();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      cv.removeEventListener("touchstart", onTouchStart);
      cv.removeEventListener("touchmove", onTouchMove);
      cv.removeEventListener("touchend", onTouchEnd);
      cv.removeEventListener("touchcancel", onTouchCancel);
      cv.removeEventListener("mousemove", onMouseMove);
      cv.removeEventListener("click", onClick);
      cv.removeEventListener("keydown", onKey);
      renderer.current = null;
    };
  }, [session]);

  return (
    <div ref={wrap} className="game-board" data-testid="game-board" data-drops="0">
      <canvas
        ref={canvas}
        tabIndex={0}
        role="application"
        aria-label={t.boardLabel}
        className="game-canvas"
        data-testid="game-canvas"
      />
    </div>
  );
}

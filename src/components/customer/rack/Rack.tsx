"use client";

import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, type KeyboardEvent, type Ref, type RefObject } from "react";
import { copy } from "@/copy";
import type { MenuProduct } from "@/lib/api";
import { Pendulum, Spring, createLoop, rubberBand, snapTarget, type Loop } from "@/lib/motion";
import { useMotionPrefs } from "@/lib/motion/react";
import { ProductPhoto } from "../ProductCard";
import { bindDrag } from "./drag";
import {
  cardPose,
  dropDelayMs,
  dropStartPx,
  nearestIndex,
  rackMetrics,
  restAngle,
  ropePath,
  ropeStrands,
  type RackMetrics,
} from "./geometry";
import { Peg } from "./Peg";

const t = copy.customer.brand;

const SWAY_SPRING = { frequencyHz: 1.3, dampingRatio: 0.3 };
const DROP_SPRING = { frequencyHz: 1.25, dampingRatio: 0.55 };
const SPIN_MS = 640;
/** A touch that travels less than this and is shorter than TAP_MS is a tap, whatever axis it briefly locked to. */
const TAP_PX = 8;
const TAP_MS = 600;

/** What the home page can ask of the rack (take a card down, hang it back, nudge the pegs). */
export interface RackHandle {
  /** Slide the rope to slot `i` (spring). */
  goTo(i: number): void;
  /** Put the rope on slot `i` right now and lay the cards out synchronously (before measuring them). */
  jumpTo(i: number): void;
  /** Spin card `i` once around its vertical axis (the "take down" flourish). No-op under reduced motion. */
  spin(i: number): void;
  /** Bounding rect of card `i`'s hanging block (peg + photo), as it is on screen right now. */
  hangRect(i: number): DOMRect | null;
  /** Bounding rect of card `i`'s photo. */
  faceRect(i: number): DOMRect | null;
  /** Hide (true) or show card `i`'s hanging block while its photo is in the detail view. */
  setTaken(i: number, taken: boolean): void;
  /** Kick card `i`'s peg (angular velocity, rad/s) so it swings. */
  kick(i: number, omega: number): void;
  /** The photo of card `i` came back: swing it and its neighbours, make the rope sway. */
  landed(i: number): void;
  focus(): void;
}

export interface RackProps {
  products: readonly MenuProduct[];
  /** Slot nearest to the centre, mirrored from the rope (for aria-selected). */
  index: number;
  /** The rope settled nearer to another slot (called while dragging and flinging). */
  onIndexChange: (i: number) => void;
  /** Tap on the centred card, or Enter. */
  onOpen: (i: number) => void;
  /** The element that receives the gestures: the whole coloured hero (D77). */
  hostRef: RefObject<HTMLElement | null>;
  /** False while a card is being taken down or the detail is open: the rack ignores input. */
  active: boolean;
  /** Hide the "try me" hint (after the first detail view). */
  hintOff: boolean;
  ref?: Ref<RackHandle>;
}

interface CardSim {
  pend: Pendulum;
  drop: Spring;
  delay: number;
  rest: number;
  /** Last pivot position / velocity / smoothed acceleration, for the pendulum drive. */
  px: number | null;
  v: number;
  a: number;
}

interface Sim {
  rope: Spring;
  sway: Spring;
  cards: CardSim[];
  m: RackMetrics;
  idx: number;
  drag: boolean;
  g0: number;
  moving: boolean;
  tap: number | null;
  t0: number;
  dPath: string;
}

function createSim(n: number, reduced: boolean): Sim {
  const cards: CardSim[] = [];
  for (let i = 0; i < n; i++) {
    const drop = new Spring(reduced ? 0 : dropStartPx(i), DROP_SPRING);
    drop.target = 0;
    cards.push({ pend: new Pendulum(), drop, delay: reduced ? 0 : dropDelayMs(i), rest: restAngle(i), px: null, v: 0, a: 0 });
  }
  return {
    rope: new Spring(0),
    sway: new Spring(0, SWAY_SPRING),
    cards,
    m: rackMetrics(375),
    idx: 0,
    drag: false,
    g0: 0,
    moving: false,
    tap: null,
    t0: typeof performance === "undefined" ? 0 : performance.now(),
    dPath: "",
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The rope with its clothes-pegged photos (FRONTEND.md 4.1 item 3, D77).
 * All motion is driven by one rAF loop that writes `style.transform` directly and stops when
 * everything rests; React only re-renders on index changes.
 */
export function Rack({ products, index, onIndexChange, onOpen, hostRef, active, hintOff, ref }: RackProps) {
  const { reduced, degraded } = useMotionPrefs();
  const n = products.length;
  const uid = useId().replace(/:/g, "");
  const root = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const sim = useRef<Sim | null>(null);
  const loop = useRef<Loop | null>(null);
  const stepFn = useRef<((dt: number, now: number) => boolean) | null>(null);
  const els = useRef<{ cards: HTMLElement[]; hangs: HTMLElement[]; flips: HTMLElement[] }>({ cards: [], hangs: [], flips: [] });
  // Latest props for the long-lived loop and gesture closures (never read during render).
  const latest = useRef({ onIndexChange, onOpen, active, reduced, degraded });
  useLayoutEffect(() => {
    latest.current = { onIndexChange, onOpen, active, reduced, degraded };
  });

  // ---- simulation + loop ----
  useLayoutEffect(() => {
    const rackEl = root.current;
    if (!rackEl || n === 0) return;
    const cards = [...rackEl.querySelectorAll<HTMLElement>("[data-card]")];
    const hangs = cards.map((c) => c.querySelector<HTMLElement>(".hm-hang")!);
    const flips = cards.map((c) => c.querySelector<HTMLElement>(".hm-flip")!);
    els.current = { cards, hangs, flips };
    const pathsOf = (cls: string) => rackEl.querySelector<SVGPathElement>(`.hm-rope .${cls}`)!;
    const shared = [pathsOf("rsh"), pathsOf("rb"), pathsOf("rh")];
    const twist = pathsOf("rt");
    const twist2 = pathsOf("rt2");

    const s = createSim(n, latest.current.reduced);
    sim.current = s;

    const measure = () => {
      const m = rackMetrics(rackEl.clientWidth);
      s.m = m;
      rackEl.style.setProperty("--cw", `${m.cardW}px`);
      rackEl.style.setProperty("--rh", `${m.height}px`);
      if (hint.current) {
        hint.current.style.right = `${Math.max(4, (m.width - m.cardW) / 2 - 40)}px`;
        hint.current.style.top = `${m.y0 - 30}px`;
      }
      s.dPath = "";
      s.cards.forEach((c) => (c.px = null));
    };
    measure();

    const frame = (dt: number, now: number): boolean => {
      const { reduced: rm, degraded: dg, onIndexChange: change } = latest.current;
      let act = false;
      const { m } = s;
      // rope position
      if (!s.drag) {
        if (rm) s.rope.settle();
        else {
          s.rope.step(dt);
          if (s.rope.isAtRest()) s.rope.settle();
          else act = true;
        }
      } else act = true;
      if (rm) s.sway.settle();
      else {
        s.sway.step(dt);
        if (s.sway.isAtRest(0.02, 0.05)) s.sway.settle();
        else act = true;
      }
      const pos = s.rope.x;
      const idx = nearestIndex(pos, n);
      if (idx !== s.idx) {
        s.idx = idx;
        change(idx);
      }
      // rope curve
      const sag = m.sag + s.sway.x;
      const d = ropePath(m, sag);
      if (d !== s.dPath) {
        s.dPath = d;
        shared.forEach((p) => p.setAttribute("d", d));
        const st = ropeStrands(m, sag);
        twist.setAttribute("d", st.dark);
        twist2.setAttribute("d", st.light);
      }
      // cards
      const elapsed = now - s.t0;
      for (let i = 0; i < n; i++) {
        const c = s.cards[i];
        const pose = cardPose(i, pos, m, sag);
        if (elapsed > c.delay) {
          c.drop.step(dt);
          if (c.drop.isAtRest(0.3, 2)) c.drop.settle();
          else act = true;
        } else act = true;
        const dy = c.drop.x;
        const px = pose.cx;
        if (c.px === null) {
          c.px = px;
          c.v = 0;
          c.a = 0;
        }
        if (dt > 0) {
          const v = (px - c.px) / dt;
          const ac = (v - c.v) / dt;
          c.v = v;
          c.a = c.a * 0.5 + ac * 0.5;
        }
        c.px = px;
        let ang = 0;
        if (!rm && !dg) {
          let drive = c.a / 900;
          if (dy < -1 && elapsed > c.delay) drive += (c.drop.v / 2400) * (i % 2 ? -1 : 1);
          c.pend.step(dt, drive);
          if (c.pend.isAtRest()) c.pend.settle();
          else act = true;
          ang = c.pend.angle;
        } else c.pend.settle();
        const el = cards[i];
        el.style.transform = `translate3d(${(px - m.cardW / 2).toFixed(2)}px,${(pose.top + dy).toFixed(2)}px,0) scale(${pose.scale.toFixed(4)})`;
        hangs[i].style.transform = `rotate(${(-ang + c.rest).toFixed(4)}rad)`;
        el.style.opacity = String(pose.opacity);
        el.style.zIndex = String(pose.zIndex);
      }
      return act;
    };
    stepFn.current = frame;
    const lp = createLoop(frame);
    loop.current = lp;
    lp.start();

    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      measure();
      lp.start();
    });
    ro?.observe(rackEl);
    return () => {
      lp.stop();
      ro?.disconnect();
      loop.current = null;
      stepFn.current = null;
      sim.current = null;
    };
  }, [n]);

  // ---- gestures on the whole hero (D77) ----
  useEffect(() => {
    const host = hostRef.current;
    if (!host || n === 0) return;
    return bindDrag(host, {
      axis: "x",
      horizontalBias: 0.75,
      lockPx: 4,
      canStart: (target) => {
        if (!sim.current || !latest.current.active) return false;
        return !target?.closest("button, a, [data-no-drag]");
      },
      onStart: (_x, _y, target) => {
        const s = sim.current;
        if (!s) return;
        s.g0 = s.rope.x;
        const card = target?.closest<HTMLElement>("[data-card]");
        s.tap = card ? Number(card.dataset.card) : null;
        s.moving = Math.abs(s.rope.v) > 1.2;
      },
      onDrag: (dx) => {
        const s = sim.current;
        if (!s) return;
        s.drag = true;
        s.rope.set(rubberBand(s.g0 - dx / s.m.spacing, 0, n - 1), 0);
        loop.current?.start();
      },
      onEnd: (end) => {
        const s = sim.current;
        if (!s) return;
        // A finger rolling a few px is still a tap (browsers allow about 10 px).
        const isTap = !end.cancelled && end.travel < TAP_PX && end.duration < TAP_MS;
        if (s.drag && isTap) {
          s.drag = false;
          s.rope.set(s.g0, 0);
          s.rope.target = Math.round(s.g0);
        }
        if (s.drag) {
          s.drag = false;
          const start = Math.round(s.g0);
          s.rope.target = snapTarget(s.rope.x, start, end.cancelled ? 0 : (-end.fling as -1 | 0 | 1), n);
          s.rope.v = clamp((-end.velocity * 1000) / s.m.spacing, -12, 12);
          if (!latest.current.reduced) s.sway.v += Math.min(Math.abs(s.rope.v) * 5, 40);
          loop.current?.start();
        } else if (isTap && s.tap !== null && !s.moving) {
          const i = s.tap;
          if (i === nearestIndex(s.rope.x, n) && s.rope.isAtRest(0.06, 0.6)) latest.current.onOpen(i);
          else {
            s.rope.target = i;
            loop.current?.start();
          }
        }
        s.tap = null;
      },
    });
  }, [hostRef, n]);

  useImperativeHandle(
    ref,
    () => ({
      goTo(i) {
        const s = sim.current;
        if (!s) return;
        s.rope.target = clamp(i, 0, n - 1);
        loop.current?.start();
      },
      jumpTo(i) {
        const s = sim.current;
        if (!s) return;
        const k = clamp(i, 0, n - 1);
        s.rope.set(k, 0);
        s.rope.target = k;
        // The jump must not look like a violent shake of the pivots to the pegs.
        s.cards.forEach((c) => {
          c.px = null;
          c.v = 0;
          c.a = 0;
        });
        stepFn.current?.(0, performance.now());
      },
      spin(i) {
        const s = sim.current;
        const flip = els.current.flips[i];
        if (!s || !flip || latest.current.reduced || typeof flip.animate !== "function") return;
        flip.animate(
          [{ transform: "rotateY(0)" }, { transform: "rotateY(200deg)", offset: 0.55 }, { transform: "rotateY(360deg)" }],
          { duration: SPIN_MS, easing: "cubic-bezier(.45,.05,.25,1)" },
        );
        s.cards[i].pend.omega += 1.2;
        loop.current?.start();
      },
      hangRect: (i) => els.current.hangs[i]?.getBoundingClientRect() ?? null,
      faceRect: (i) => els.current.cards[i]?.querySelector(".hm-face")?.getBoundingClientRect() ?? null,
      setTaken(i, taken) {
        els.current.cards[i]?.classList.toggle("is-taken", taken);
      },
      kick(i, omega) {
        const s = sim.current;
        if (!s || latest.current.reduced || !s.cards[i]) return;
        s.cards[i].pend.omega += omega;
        loop.current?.start();
      },
      landed(i) {
        const s = sim.current;
        if (!s || latest.current.reduced) return;
        s.cards.forEach((c, k) => {
          c.pend.omega += k === i ? 2.2 : k < i ? -0.7 : 0.7;
        });
        s.sway.v += 36;
        loop.current?.start();
      },
      focus: () => root.current?.focus({ preventScroll: true }),
    }),
    [n],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const s = sim.current;
    if (!s || !latest.current.active) return;
    const cur = Math.round(s.rope.target);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      s.rope.target = clamp(cur + (e.key === "ArrowRight" ? 1 : -1), 0, n - 1);
      loop.current?.start();
      e.preventDefault();
    } else if (e.key === "Enter" || e.key === " ") {
      latest.current.onOpen(clamp(cur, 0, n - 1));
      e.preventDefault();
    }
  };

  const fid = `rsh-${uid}`;
  return (
    <div
      ref={root}
      className="hm-rack"
      tabIndex={0}
      role="listbox"
      aria-label={t.rackLabel}
      aria-activedescendant={`${uid}-c${index}`}
      data-testid="rack"
      onKeyDown={onKeyDown}
    >
      <svg className="hm-rope" aria-hidden="true" focusable="false">
        <defs>
          <filter id={fid} x="-5%" y="-200%" width="110%" height="500%">
            <feGaussianBlur stdDeviation="2.2" />
          </filter>
        </defs>
        <path className="rsh" style={{ filter: `url(#${fid})` }} />
        <path className="rb" />
        <path className="rt" />
        <path className="rt2" />
        <path className="rh" />
      </svg>
      {products.map((p, i) => (
        <div
          key={p.id}
          id={`${uid}-c${i}`}
          className={`hm-card ${p.status === "PAUSED" ? "is-paused" : ""}`}
          data-card={i}
          data-testid="rack-item"
          data-product-id={p.id}
          role="option"
          aria-selected={i === index}
          aria-label={p.name}
        >
          <div className="hm-hang">
            <Peg />
            <div className="hm-flip">
              <div className="hm-face">
                <ProductPhoto product={p} className="h-full w-full" eager={i === 0} decorative />
              </div>
              <div className="hm-face hm-back">
                <ProductPhoto product={p} className="h-full w-full" eager={i === 0} decorative />
              </div>
            </div>
          </div>
        </div>
      ))}
      <div ref={hint} className={`hm-try ${hintOff ? "is-off" : ""}`} aria-hidden="true" data-testid="try-me">
        <span>{t.tryMe}</span>
        <svg viewBox="0 0 70 60">
          <path
            d="M62 6C48 4 40 12 44 20s14 2 8-6S30 8 24 24 14 46 8 52"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path d="M4 44l3.5 9.5L17 50" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

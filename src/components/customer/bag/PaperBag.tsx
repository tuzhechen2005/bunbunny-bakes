"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Logo } from "@/components/brand/Logo";
import { copy } from "@/copy";
import { createLoop, rubberBand, PILE_WIDTH, PileWorld, radiusFor, Spring, type Loop, type PileBody } from "@/lib/motion";
import { useMotionPrefs } from "@/lib/motion/react";
import { EASE, done, play } from "./anim";
import "./bag.css";

/** What is in the bag: one entry per product (qty 0 is allowed and means "none, but known"). */
export interface PaperBagItem {
  productId: string;
  imageUrl: string | null;
  qty: number;
}

export interface PaperBagHandle {
  /** Kick the pile upwards for a moment (ay < 0 is up, world units/s^2, e.g. -2600 or -30000). */
  jolt(ay: number, ms?: number): void;
  /** Squash the bag and let it recover. `land` is the soft one, `slam` the stamp impact. */
  squash(kind?: "land" | "slam"): void;
  /** Bounding box of the window (where flights land); null before mount. */
  windowRect(): DOMRect | null;
  /**
   * Extension used by the home bag: drop `count` bodies of a product into the pile at `xFrac`
   * (0..1 across the window, null = anywhere), exactly where a flight came down.
   */
  drop(productId: string, count: number, xFrac?: number | null): void;
}

export interface PaperBagProps {
  /** Bag width in px (height is 1.497 x). */
  width: number;
  items: readonly PaperBagItem[];
  /** Folds the top down; animates when it turns true, renders folded when true on mount. */
  folded?: boolean;
  /** Layer above the flap (the order stamp), centred at 60% height, 80% of the width. */
  imprint?: ReactNode;
  /** Drag the bag to shake it: it moves with the finger and the pile rolls around. */
  shakeable?: boolean;
  className?: string;
}

/** Window width as a share of the bag (right and left insets of the photo). */
const WINDOW_W = 0.73;
const SPRING_SHAKE = { frequencyHz: 2.2, dampingRatio: 0.28 };

function buildZigzag(): string {
  const N = 12;
  const pts: string[] = [];
  for (let k = 0; k <= N; k++) pts.push(`${((k / N) * 100).toFixed(2)}% ${k % 2 ? "100%" : "91%"}`);
  return `polygon(0 0,100% 0,${pts.reverse().join(",")})`;
}
const ZIGZAG = buildZigzag();

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const restsAt = (s: Spring) => Math.abs(s.target - s.x) < 0.2 && Math.abs(s.v) < 1;

/** Idempotent: also used to refresh a disc when its product photo URL arrives or changes. */
function setImage(el: HTMLElement, url: string | null | undefined) {
  const next = url ?? "";
  if (el.dataset.img === next) return;
  el.dataset.img = next;
  if (url) {
    el.style.backgroundImage = `url("${url.replace(/"/g, "%22")}")`;
    el.classList.remove("pb-ph");
  } else {
    el.style.backgroundImage = "";
    el.classList.add("pb-ph");
  }
}

interface ShakeState {
  sx: Spring;
  sy: Spring;
  on: boolean;
  x0: number;
  y0: number;
  lx: number;
  ly: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
}

/**
 * The kraft paper bag with its glass window (public/brand/bag.webp) and a real pile of round
 * bread thumbnails inside (src/lib/motion/pile.ts). The pile follows `items`: growth drops new
 * bodies in, shrinking pops them out of the top, the first paint is already settled. Used by the
 * home bag bar and bag sheet and by the order page (folded, with the stamp as `imprint`).
 */
export const PaperBag = forwardRef<PaperBagHandle, PaperBagProps>(function PaperBag(
  { width, items, folded = false, imprint, shakeable = false, className },
  ref,
) {
  const { reduced, degraded } = useMotionPrefs();
  const reducedRef = useRef(reduced);
  const degradedRef = useRef(degraded);
  useEffect(() => {
    reducedRef.current = reduced;
    degradedRef.current = degraded;
  }, [reduced, degraded]);

  const [world] = useState(() => new PileWorld());
  const rootRef = useRef<HTMLDivElement>(null);
  const swRef = useRef<HTMLDivElement>(null);
  const inRef = useRef<HTMLDivElement>(null);
  const winRef = useRef<HTMLDivElement>(null);
  const pileRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<number, HTMLElement>());
  const images = useRef(new Map<string, string | null>());
  const widthRef = useRef(width);
  const loopRef = useRef<Loop | null>(null);
  const started = useRef(false);
  const mountedAt = useRef(0);
  const dropped = useRef(false);
  const wasFolded = useRef(folded);
  const jolt = useRef<{ ay: number; timer: ReturnType<typeof setTimeout> | undefined }>({ ay: 0, timer: undefined });
  const shake = useRef<ShakeState>({
    sx: new Spring(0, SPRING_SHAKE),
    sy: new Spring(0, SPRING_SHAKE),
    on: false,
    x0: 0,
    y0: 0,
    lx: 0,
    ly: 0,
    vx: 0,
    vy: 0,
    ax: 0,
    ay: 0,
  });

  useEffect(() => {
    widthRef.current = width;
    render();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- render reads refs only
  }, [width]);

  function wake() {
    loopRef.current?.start();
  }

  function applyExternal() {
    const k = shake.current;
    world.ax = k.ax;
    world.ay = k.ay + jolt.current.ay;
  }

  function render() {
    const pile = pileRef.current;
    if (!pile) return;
    const s = (widthRef.current * WINDOW_W) / PILE_WIDTH;
    const seen = new Set<number>();
    for (const b of world.bodies) {
      seen.add(b.id);
      let el = els.current.get(b.id);
      if (!el) {
        el = document.createElement("i");
        el.className = "pb-pi";
        setImage(el, images.current.get(b.tag));
        pile.appendChild(el);
        els.current.set(b.id, el);
      }
      const d = 2 * b.r * s;
      el.style.width = el.style.height = `${d.toFixed(1)}px`;
      el.style.transform = `translate(${((b.x - b.r) * s).toFixed(1)}px,${((b.y - b.r) * s).toFixed(1)}px) rotate(${b.a.toFixed(3)}rad)`;
    }
    for (const [id, el] of els.current) {
      if (!seen.has(id)) {
        el.remove();
        els.current.delete(id);
      }
    }
  }

  function tickShake(dt: number): boolean {
    const k = shake.current;
    if (!k.on) {
      k.sx.step(dt);
      k.sy.step(dt);
    }
    const x = k.sx.x;
    const y = k.sy.x;
    if (dt > 0) {
      const vx = (x - k.lx) / dt;
      const vy = (y - k.ly) / dt;
      const ax = (vx - k.vx) / dt;
      const ay = (vy - k.vy) / dt;
      k.vx = vx;
      k.vy = vy;
      k.lx = x;
      k.ly = y;
      k.ax = clamp(-ax * 0.9, -60000, 60000);
      k.ay = clamp(-ay * 0.9, -60000, 60000);
      if (Math.abs(k.ax) < 200) k.ax = 0;
      if (Math.abs(k.ay) < 200) k.ay = 0;
      applyExternal();
      if (k.ax || k.ay) world.wake();
    }
    const moving = k.on || !restsAt(k.sx) || !restsAt(k.sy);
    const sw = swRef.current;
    // Low fps: keep the translation, drop the side tilt.
    const tilt = degradedRef.current ? 0 : x * 0.25;
    if (sw) sw.style.transform = moving ? `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${tilt.toFixed(2)}deg)` : "";
    if (!moving) {
      k.ax = k.ay = 0;
      k.sx.settle();
      k.sy.settle();
      applyExternal();
    }
    return moving;
  }

  useEffect(() => {
    const loop = createLoop((dt) => {
      let active = false;
      if (shake.current.on || !restsAt(shake.current.sx) || !restsAt(shake.current.sy)) active = tickShake(dt);
      if (world.advance(dt)) active = true;
      render();
      return active;
    });
    loopRef.current = loop;
    if (world.awake) loop.start();
    return () => {
      loop.stop();
      loopRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the loop only touches refs and the world
  }, []);

  /** Pop removed bodies out of the bag top. */
  function popOut(removed: readonly PileBody[]) {
    for (const b of removed) {
      const el = els.current.get(b.id);
      if (!el) continue;
      els.current.delete(b.id);
      if (reducedRef.current) {
        el.remove();
        continue;
      }
      const tr = el.style.transform;
      const a = play(
        el,
        [
          { transform: tr, opacity: 1 },
          { transform: `${tr} translateY(-140%) scale(.6)`, opacity: 0 },
        ],
        { duration: 360, easing: EASE, fill: "forwards" },
        false,
      );
      void done(a).then(() => el.remove());
      if (!a) el.remove();
    }
  }

  function spawnMany(tag: string, n: number, xw?: number, instant = false) {
    dropped.current = true;
    for (let i = 0; i < n; i++) {
      const r = radiusFor(world.size + 1);
      world.spawn(tag, xw, i === 0 ? undefined : -r * 1.1 - i * r * 1.6);
    }
    if (instant || reducedRef.current) {
      world.settle();
      render();
    } else {
      render();
      wake();
    }
  }

  // Keep the pile in step with `items`. The initial state settles at once: the first run, and the
  // one right after hydration when the saved cart shows up a moment later.
  useLayoutEffect(() => {
    const now = performance.now();
    const first = !started.current;
    if (first) {
      started.current = true;
      mountedAt.current = now;
    }
    const initial = first || (world.size === 0 && !dropped.current && now - mountedAt.current < 800);
    images.current = new Map(items.map((it) => [it.productId, it.imageUrl]));
    // The menu can arrive after the cart: refresh the photo of discs that already exist.
    for (const b of world.bodies) {
      const el = els.current.get(b.id);
      if (el) setImage(el, images.current.get(b.tag));
    }
    const want = new Map<string, number>();
    for (const it of items) {
      const q = Math.max(0, Math.floor(it.qty));
      if (q > 0) want.set(it.productId, (want.get(it.productId) ?? 0) + q);
    }
    const removed: PileBody[] = [];
    for (const tag of new Set(world.bodies.map((b) => b.tag))) {
      const have = world.count(tag);
      const w = want.get(tag) ?? 0;
      if (have > w) removed.push(...world.remove(tag, have - w));
    }
    // Round robin so a cap of 24 is shared fairly between products.
    let added = 0;
    let progress = true;
    while (world.size < world.cap && progress) {
      progress = false;
      for (const [tag, w] of want) {
        if (world.size >= world.cap) break;
        if (world.count(tag) < w) {
          const r = radiusFor(world.size + 1);
          world.spawn(tag, undefined, added === 0 ? undefined : -r * 1.1 - added * r * 1.6);
          added++;
          progress = true;
        }
      }
    }
    if (removed.length) popOut(removed);
    if (initial || reducedRef.current) {
      if (added || removed.length) world.settle();
      render();
    } else {
      render();
      if (world.awake) wake();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync on items only
  }, [items]);

  // Fold the top down when `folded` turns true.
  useEffect(() => {
    if (folded && !wasFolded.current && !reducedRef.current) {
      play(
        topRef.current,
        [{ transform: "rotateX(0)" }, { transform: "rotateX(-200deg)", offset: 0.75 }, { transform: "rotateX(-180deg)" }],
        { duration: 520, easing: EASE, fill: "forwards" },
        false,
      );
      const t = setTimeout(() => {
        play(
          inRef.current,
          [{ transform: "none" }, { transform: "scale(1.03,.96)" }, { transform: "none" }],
          { duration: 260, easing: EASE },
          false,
        );
      }, 360);
      wasFolded.current = folded;
      return () => clearTimeout(t);
    }
    wasFolded.current = folded;
  }, [folded]);

  // Shake by dragging: touch events for fingers (the page must not scroll), pointer events for mouse.
  useEffect(() => {
    const el = rootRef.current;
    if (!shakeable || reduced || !el) return;
    const k = shake.current;
    const begin = (x: number, y: number) => {
      k.on = true;
      k.x0 = x;
      k.y0 = y;
      world.wake();
      wake();
    };
    const move = (x: number, y: number) => {
      if (!k.on) return;
      k.sx.set(rubberBand((x - k.x0) / 60, -1, 1) * 60);
      k.sy.set(rubberBand((y - k.y0) / 50, -1, 1) * 50);
      wake();
    };
    const end = () => {
      if (!k.on) return;
      k.on = false;
      k.sx.target = 0;
      k.sy.target = 0;
      world.wake();
      wake();
    };

    let touchId: number | null = null;
    const find = (e: TouchEvent) => Array.from(e.changedTouches).find((t) => t.identifier === touchId);
    const onTouchStart = (e: TouchEvent) => {
      if (touchId !== null) return;
      const t = e.changedTouches[0];
      touchId = t.identifier;
      begin(t.clientX, t.clientY);
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = find(e);
      if (!t) return;
      if (e.cancelable) e.preventDefault();
      move(t.clientX, t.clientY);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!find(e)) return;
      touchId = null;
      end();
    };

    let pid: number | null = null;
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch" || pid !== null) return;
      pid = e.pointerId;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* capture is optional */
      }
      begin(e.clientX, e.clientY);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId === pid) move(e.clientX, e.clientY);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      pid = null;
      end();
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      if (k.on) {
        k.on = false;
        k.sx.target = 0;
        k.sy.target = 0;
        wake();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers only touch refs and the world
  }, [shakeable, reduced]);

  useEffect(() => {
    const j = jolt.current;
    return () => clearTimeout(j.timer);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      jolt(ay: number, ms = 60) {
        if (reducedRef.current) return;
        const j = jolt.current;
        clearTimeout(j.timer);
        j.ay = ay;
        applyExternal();
        world.wake();
        wake();
        j.timer = setTimeout(() => {
          j.ay = 0;
          applyExternal();
          world.wake();
          wake();
        }, ms);
      },
      squash(kind = "land") {
        if (reducedRef.current) return;
        if (kind === "slam") {
          play(
            inRef.current,
            [
              { transform: "none" },
              { transform: "scale(1.07,.86) translateY(5%)", offset: 0.18 },
              { transform: "scale(.97,1.04)", offset: 0.5 },
              { transform: "none" },
            ],
            { duration: 520, easing: "ease-out" },
            false,
          );
        } else {
          play(
            inRef.current,
            [
              { transform: "none" },
              { transform: "scale(1.06,.9)", offset: 0.3 },
              { transform: "scale(.98,1.04)", offset: 0.65 },
              { transform: "none" },
            ],
            { duration: 380, easing: EASE },
            false,
          );
        }
      },
      windowRect() {
        return winRef.current ? winRef.current.getBoundingClientRect() : null;
      },
      drop(productId, count, xFrac) {
        const xw = xFrac == null ? undefined : clamp(xFrac, 0, 1) * PILE_WIDTH;
        spawnMany(productId, Math.max(0, Math.floor(count)), xw);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the handle only touches refs and the world
    [],
  );

  const style = { "--bw": `${width}px` } as CSSProperties;
  return (
    <div
      ref={rootRef}
      className={`pb ${width <= 80 ? "pb-sm" : ""} ${shakeable ? "pb-shakeable" : ""} ${className ?? ""}`}
      style={style}
      data-testid="paper-bag"
    >
      <div ref={swRef} className="pb-sw">
        <div ref={inRef} className="pb-in">
          <div ref={winRef} className="pb-win" data-pb-window="">
            <div ref={pileRef} className="pb-pile" />
          </div>
          <div className="pb-body" />
          <div ref={topRef} className="pb-top" style={folded ? { transform: "rotateX(-180deg)" } : undefined}>
            <i className="pb-ft">
              <span className="pb-print">
                <Logo className="pb-logo" />
                <span aria-hidden="true" className="font-display">
                  {copy.customer.brand.wordmark}
                </span>
              </span>
            </i>
            <i className="pb-bk pb-kraft" style={{ clipPath: ZIGZAG }} />
          </div>
          {imprint ? <div className="pb-imprint">{imprint}</div> : null}
        </div>
      </div>
    </div>
  );
});

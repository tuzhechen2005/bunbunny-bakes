"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RollNumber } from "@/components/customer/checkout/RollNumber";
import { fill } from "@/components/customer/format";
import { sound } from "@/components/game/sound";
import type { TierView } from "@/components/game/types";
import { copy } from "@/copy";
import { createTuGame, MIN_TAP_GAP_MS, type TuEvent, type TuGame, type TuState } from "@/lib/tu";
import { haptic } from "@/lib/motion/react";
import { photoUrl } from "@/lib/photo";
import type { TuTapLog } from "./tuApi";
import { isPropEntry, orderCompleteText, propEvents, PROP_KINDS, type PropCounts, type PropKind } from "./tuProps";
import { isVisible, revealedIds } from "./tuVisible";
import "./tu.css";

const t = copy.customer.tu;
const MIN_TILE = 44;
const MAX_TILE = 68;
const nowMs = () => Date.now();
const FLY_MS = 260;
const POP_MS = 320;
const PEEK_MS = 3000;
const SEEN_KEY = "bb_tu_orders_seen_v1";
const MAX_SLOTS = 7;

/** Our own line icons, ink colour: magnifier, paper bag with a plus, two swap arrows. */
function PropIcon({ kind }: { kind: PropKind }) {
  const common = { viewBox: "0 0 24 24", className: "size-6", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (kind === "peek")
    return (
      <svg {...common}>
        <circle cx="10.5" cy="10.5" r="6" />
        <path d="M15 15l5 5" />
      </svg>
    );
  if (kind === "bag")
    return (
      <svg {...common}>
        <path d="M5.5 8.5h13l-1 11.5h-11z" />
        <path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" />
        <path d="M12 11.8v5M9.5 14.3h5" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M4 8h15M15.5 4.5L19 8l-3.5 3.5" />
      <path d="M20 16H5M8.5 12.5L5 16l3.5 3.5" />
    </svg>
  );
}

/** One bread tile face: the tier colour, the photo inside, the first character when there is no photo. */
export function TileFace({ tier }: { tier: TierView }) {
  const [broken, setBroken] = useState(false);
  const showImg = tier.imageUrl && !broken;
  return (
    <span className="tu-face" style={{ background: tier.color.bg, color: tier.color.ink }}>
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl(tier.imageUrl!, 256)} alt="" draggable={false} decoding="async" onError={() => setBroken(true)} />
      ) : (
        <span className="font-display text-[1.4em] leading-none" aria-hidden="true">
          {[...(tier.name ?? "")][0] ?? ""}
        </span>
      )}
    </span>
  );
}

interface View {
  bag: number[];
  orders: [number, number];
  score: number;
  batch: number;
  /** Bag slots that are being packed right now. */
  popping: number[];
  doneOrder: 0 | 1 | null;
  flash: { k: number; text: string } | null;
  banner: { k: number; n: number } | null;
  /** The slot a tile is flying into. */
  arrive: { k: number; slot: number } | null;
  /** Props left, bag size (6 or 7) and the points each order pays (C8). */
  props: PropCounts;
  bagSize: number;
  rewards: [number, number];
  /** The order and prop reward shown after an order is completed. */
  toast: { k: number; text: string } | null;
  /** The orders were swapped by a prop (a different animation from completing). */
  swapped: boolean;
}

const fromState = (s: TuState): View => ({
  bag: s.bag,
  orders: s.orders,
  score: s.score,
  batch: s.batch,
  popping: [],
  doneOrder: null,
  flash: null,
  banner: null,
  arrive: null,
  props: s.props,
  bagSize: s.bagSize,
  rewards: s.orderPoints,
  toast: null,
  swapped: false,
});

export interface TuProgress {
  taps: TuTapLog[];
  score: number;
  /** Points for the props left unused at the end (C8), 0 when none. */
  bonus?: number;
}

export interface TuPlayProps {
  tiers: TierView[];
  seed: string;
  /** Taps of a saved run: replayed without animation. */
  initialTaps?: TuTapLog[];
  soundOn: boolean;
  reduced: boolean;
  /** After every accepted tap (the autosave). */
  onProgress: (p: TuProgress) => void;
  /** Once, after the last animation of the game-ending tap. */
  onOver: (p: TuProgress) => void;
  /** Reopen the existing result without submitting or replaying the run again. */
  onShowResult?: () => void;
}

export function TuPlay({ tiers, seed, initialTaps, soundOn, reduced, onProgress, onOver, onShowResult }: TuPlayProps) {
  const game = useRef<TuGame | null>(null);
  const taps = useRef<TuTapLog[]>([]);
  const clock = useRef({ base: 0, t0: 0 });
  const [snap, setSnapRaw] = useState<TuState | null>(null);
  /** The bounding box of the board, kept while a batch is being dealt. */
  const [geo, setGeo] = useState({ minX: 0, minY: 0, bw: 7, bh: 8 });
  const setSnap = useCallback((st: TuState) => {
    setSnapRaw(st);
    if (st.tiles.length === 0) return;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const x of st.tiles) {
      minX = Math.min(minX, x.x);
      maxX = Math.max(maxX, x.x + 1);
      minY = Math.min(minY, x.y);
      maxY = Math.max(maxY, x.y + 1);
    }
    setGeo({ minX, minY, bw: maxX - minX, bh: maxY - minY });
  }, []);
  const [view, setView] = useState<View | null>(null);
  /** Tiles that were just revealed (they pop in once). */
  const [popIn, setPopIn] = useState<number[]>([]);
  const [pulse, setPulse] = useState(false);
  const [peeking, setPeeking] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bonusRef = useRef(0);
  const view0 = useRef<View | null>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const areaRef = useRef<HTMLDivElement>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const lock = useRef(false);
  const alive = useRef(true);
  const flyFrom = useRef<{ rect: DOMRect; slot: number } | null>(null);
  const keyN = useRef(0);
  const soundRef = useRef(soundOn);
  const reducedRef = useRef(reduced);
  const cb = useRef({ onProgress, onOver });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const bagRef = useRef<HTMLDivElement>(null);
  const [bagW, setBagW] = useState(0);
  useEffect(() => {
    soundRef.current = soundOn;
    reducedRef.current = reduced;
    cb.current = { onProgress, onOver };
  });

  // The game is built once per run (the page remounts this component with a new key).
  useEffect(() => {
    alive.current = true;
    // Test seam: e2e may inject a scripted engine (the server replays every tap with the real one anyway).
    const make = (globalThis as { __tuEngine?: typeof createTuGame }).__tuEngine ?? createTuGame;
    const g = make({ seed, tiers: tiers.map((x) => ({ id: x.id })) });
    bonusRef.current = 0;
    for (const tp of initialTaps ?? []) {
      const events = isPropEntry(tp) ? g.use(tp.p) : g.tap(tp.id);
      if (events) bonusRef.current += propEvents(events).bonus;
    }
    game.current = g;
    taps.current = [...(initialTaps ?? [])];
    // After a resume the clock continues from the last tap, one minimum gap later.
    clock.current = { base: taps.current.length ? taps.current[taps.current.length - 1].at + MIN_TAP_GAP_MS : 0, t0: nowMs() };
    const st = g.state();
    /* Building the engine state once on mount. */
    /* eslint-disable react-hooks/set-state-in-effect */
    setSnap(st);
    setView(fromState(st));
    /* eslint-enable react-hooks/set-state-in-effect */
    // A saved run that is already over goes straight to the result flow.
    if (g.over) cb.current.onOver({ taps: taps.current, score: g.score, bonus: bonusRef.current });
    // The first game ever: the two order cards pulse once so the new player looks at them.
    try {
      if (!initialTaps?.length && !window.localStorage.getItem(SEEN_KEY)) {
        window.localStorage.setItem(SEEN_KEY, "1");
        setPulse(true);
        timers.current.push(setTimeout(() => setPulse(false), 1400));
      }
    } catch {
      /* no storage: no pulse */
    }
    const pending = timers.current;
    return () => {
      alive.current = false;
      pending.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ready = view !== null;
  useEffect(() => {
    view0.current = view;
  });
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setArea({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);
  useEffect(() => {
    const el = bagRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBagW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);

  const sleep = useCallback(
    (ms: number) =>
      new Promise<void>((res) => {
        if (ms <= 0) return res();
        timers.current.push(setTimeout(res, ms));
      }),
    [],
  );
  const later = useCallback((fn: () => void, ms: number) => {
    const timer = setTimeout(() => alive.current && fn(), ms);
    timers.current.push(timer);
    return timer;
  }, []);

  /** Applies the events of one tap to the bag, orders and score, one visible step at a time. */
  const play = useCallback(
    async (events: TuEvent[], after: TuState, hasBatch: boolean, finalScore: number) => {
      const red = reducedRef.current;
      const snd = soundRef.current;
      const pe = propEvents(events);
      const swapping = pe.used === "swap";
      bonusRef.current += pe.bonus;
      /** Order reward / prop gained: one small line that says what just happened. */
      const toast = (text: string) => {
        const k = ++keyN.current;
        setView((v) => (v ? { ...v, toast: { k, text } } : v));
        later(() => setView((v) => (v && v.toast?.k === k ? { ...v, toast: null } : v)), 2200);
      };
      let rewardPoints: number | null = null;
      for (const ev of events) {
        if (!alive.current) return;
        if (ev.type === "move") {
          if (snd) sound.drop();
          setView((v) => {
            if (!v) return v;
            const bag = [...v.bag];
            bag.splice(ev.slot, 0, ev.tier);
            return { ...v, bag, arrive: { k: ++keyN.current, slot: ev.slot } };
          });
          await sleep(red ? 120 : FLY_MS);
        } else if (ev.type === "pack") {
          if (snd) sound.merge(ev.tier);
          haptic(14);
          setView((v) => (v ? { ...v, popping: [ev.slot, ev.slot + 1, ev.slot + 2] } : v));
          await sleep(red ? 160 : POP_MS);
          if (!alive.current) return;
          const k = ++keyN.current;
          setView((v) => {
            if (!v) return v;
            const bag = [...v.bag];
            bag.splice(ev.slot, 3);
            return { ...v, bag, popping: [], score: v.score + ev.points, flash: { k, text: `+${ev.points}` } };
          });
          later(() => setView((v) => (v && v.flash?.k === k ? { ...v, flash: null } : v)), 900);
        } else if (ev.type === "order") {
          if (swapping) {
            setView((v) => {
              if (!v) return v;
              const orders: [number, number] = [...v.orders];
              orders[ev.index] = ev.tier;
              return { ...v, orders, swapped: true };
            });
          } else {
            const pts = view0.current?.rewards[ev.index];
            if (pts != null) rewardPoints = pts;
            setView((v) => {
              if (!v) return v;
              const orders: [number, number] = [...v.orders];
              orders[ev.index] = ev.tier;
              return { ...v, orders, doneOrder: ev.index };
            });
            later(() => setView((v) => (v ? { ...v, doneOrder: null } : v)), 700);
          }
        } else if (ev.type === "batch") {
          if (peekTimer.current !== null) clearTimeout(peekTimer.current);
          peekTimer.current = null;
          setPeeking(false);
          if (snd) sound.big();
          haptic(30);
          setSnap(after);
          const k = ++keyN.current;
          setView((v) => (v ? { ...v, score: v.score + ev.bonus, batch: ev.batch, banner: { k, n: ev.batch }, orders: after.orders } : v));
          later(() => setView((v) => (v && v.banner?.k === k ? { ...v, banner: null } : v)), 1300);
          await sleep(red ? 200 : 450);
        } else if (ev.type === "over") {
          if (snd) sound.over();
        }
      }
      if (swapping) later(() => setView((v) => (v ? { ...v, swapped: false } : v)), 700);
      const rewardText = orderCompleteText(rewardPoints, events);
      if (rewardText) toast(rewardText);
      if (!alive.current) return;
      if (hasBatch) lock.current = false;
      const st = game.current ? game.current.state() : after;
      setView((v) => (v ? { ...v, score: finalScore, arrive: null, props: st.props, bagSize: st.bagSize, rewards: st.orderPoints } : v));
      if (events.some((e) => e.type === "over")) cb.current.onOver({ taps: taps.current, score: finalScore, bonus: bonusRef.current });
    },
    [sleep, later, setSnap],
  );

  /** Uses a prop: logged like a tap (C8), then its events are played. */
  const spendProp = (p: PropKind) => {
    const g = game.current;
    if (!g || g.over || lock.current) return;
    if (p === "peek" && peeking) return;
    const c = clock.current;
    const at = Math.round(c.base + (nowMs() - c.t0));
    const prev = taps.current.at(-1)?.at ?? -Infinity;
    if (at - prev < MIN_TAP_GAP_MS || at < 0) return;
    // Orders before the swap: the reward of an order that is completed later is read from the state.
    const events = g.use(p);
    if (!events) return;
    taps.current = [...taps.current, { p, at }];
    cb.current.onProgress({ taps: taps.current, score: g.score });
    const after = g.state();
    setSnap(after);
    setView((v) => (v ? { ...v, props: after.props, bagSize: after.bagSize, rewards: after.orderPoints } : v));
    if (p === "peek") {
      setPeeking(true);
      peekTimer.current = later(() => {
        peekTimer.current = null;
        setPeeking(false);
      }, PEEK_MS);
    }
    chain.current = chain.current.then(() => play(events, after, false, g.score));
  };

  const tapTile = (id: number, el: HTMLElement) => {
    const g = game.current;
    if (!g || g.over || lock.current) return;
    const c = clock.current;
    const at = Math.round(c.base + (nowMs() - c.t0));
    const prev = taps.current.at(-1)?.at ?? -Infinity;
    if (at - prev < MIN_TAP_GAP_MS || at < 0) return;
    const rect = el.getBoundingClientRect();
    const events = g.tap(id);
    if (!events) return;
    taps.current = [...taps.current, { id, at }];
    cb.current.onProgress({ taps: taps.current, score: g.score });
    const after = g.state();
    const shown = revealedIds(events);
    if (shown.length) {
      setPopIn(shown);
      later(() => setPopIn((p) => (p === shown ? [] : p)), 400);
    }
    const hasBatch = events.some((e) => e.type === "batch");
    const mv = events.find((e) => e.type === "move");
    if (mv && mv.type === "move") flyFrom.current = { rect, slot: mv.slot };
    if (hasBatch) lock.current = true;
    else setSnap(after);
    chain.current = chain.current.then(() => play(events, after, hasBatch, g.score));
  };

  // Fly the new bag tile from where the board tile was (FLIP with the Web Animations API: no rAF loop of ours).
  useLayoutEffect(() => {
    const f = flyFrom.current;
    if (!f || !view?.arrive) return;
    flyFrom.current = null;
    const to = bagRef.current?.querySelector<HTMLElement>(`[data-slot-tile="${f.slot}"]`);
    if (!to || reducedRef.current) {
      to?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 120 });
      return;
    }
    const r = to.getBoundingClientRect();
    const dx = f.rect.left + f.rect.width / 2 - (r.left + r.width / 2);
    const dy = f.rect.top + f.rect.height / 2 - (r.top + r.height / 2);
    const s = f.rect.width / r.width;
    to.animate?.(
      [{ transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transform: "none" }],
      { duration: FLY_MS, easing: "cubic-bezier(0.3, 0.7, 0.3, 1)" },
    );
  }, [view?.arrive]);

  const { minX, minY, bw, bh } = geo;
  const u = Math.max(MIN_TILE, Math.min(MAX_TILE, Math.floor(Math.min((area.w || 320) / bw, (area.h || 999) / bh))));

  const slotGap = 4;
  // Sized for 7 slots so the tiles do not change size when the extra slot appears.
  const slotPx = bagW ? Math.max(40, Math.min(64, Math.floor((bagW - 20 - slotGap * (MAX_SLOTS - 1)) / MAX_SLOTS))) : 44;
  const zigzag = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i <= 64; i++) pts.push(`${i * 7}px ${i % 2 ? "0px" : "7px"}`);
    return `polygon(${pts.join(",")}, 448px 100%, 0 100%)`;
  }, []);

  const names = (i: number) => tiers[i]?.name ?? "";
  const counts = (tier: number) => (view ? Math.min(view.bag.filter((b) => b === tier).length, 3) : 0);

  if (!snap || !view) return <div className="flex-1" />;
  const full = view.bag.length >= view.bagSize;
  const propLabel = { peek: t.propPeek, bag: t.propBag, swap: t.propSwap };
  const hiddenIds = peeking ? snap.tiles.filter((x) => !isVisible(x)).map((x) => x.id) : [];

  return (
    <>
      <div className="flex shrink-0 items-end justify-between px-3 pt-1 pb-2" data-testid="tu-hud">
        <p className="font-num m-0 text-[36px] leading-none text-c-ink" aria-live="off">
          <RollNumber value={String(view.score)} testId="tu-score" />
        </p>
        <p className="font-display m-0 pb-0.5 text-base text-c-grey" data-testid="tu-batch">
          {fill(t.batch, { n: String(view.batch) })}
        </p>
      </div>

      <p className="m-0 shrink-0 px-4 pb-1 text-xs font-bold text-c-grey" data-testid="tu-orders-label">
        {t.orders}
      </p>
      <div className="flex shrink-0 gap-2 px-3 pb-2" data-testid="tu-orders">
        {view.orders.map((tier, i) => {
          const n = counts(tier);
          const pts = view.rewards[i];
          return (
            <div
              key={i}
              role="img"
              aria-label={fill(t.orderLabelReward, { name: names(tier), n: String(n), pts: String(pts) })}
              className={`relative flex h-14 flex-1 items-center gap-2 rounded-2xl border border-c-line bg-c-paper px-2.5 ${view.doneOrder === i ? "tu-order-done" : ""} ${view.swapped ? "tu-order-swap" : ""} ${pulse ? "tu-order-pulse" : ""}`}
              data-testid={`tu-order-${i}`}
              data-tier={tier}
              data-done={view.doneOrder === i ? "1" : undefined}
            >
              <span className="relative block size-10 shrink-0">
                <TileFace tier={tiers[tier]} />
              </span>
              <span className="font-num text-xl leading-none text-c-ink">×3</span>
              <span className="ml-auto flex flex-col items-end gap-1.5" aria-hidden="true">
                <b className="font-num text-[15px] leading-none font-normal text-c-ink" data-testid={`tu-reward-${i}`}>
                  +{pts}
                </b>
                <span className="flex gap-1">
                  {[0, 1, 2].map((d) => (
                    <i key={d} className={`block size-2 rounded-full ${d < n ? "bg-c-ink" : "bg-c-line"}`} />
                  ))}
                </span>
              </span>
            </div>
          );
        })}
      </div>

      <div ref={areaRef} className="relative flex flex-1 items-start justify-center px-1.5 pt-2" style={{ minHeight: bh * MIN_TILE }} data-testid="tu-area">
        <div className="relative shrink-0" style={{ width: bw * u, height: bh * u }} data-peek={peeking ? "1" : undefined} role="group" aria-label={t.boardLabel} data-testid="tu-board" data-batch={snap.batch}>
          {snap.tiles.filter((x) => isVisible(x) || hiddenIds.includes(x.id)).map((tile) => (
            <button
              key={tile.id}
              type="button"
              className={`tu-tile ${popIn.includes(tile.id) ? "tu-reveal" : ""} ${hiddenIds.includes(tile.id) ? "tu-peeked" : ""}`}
              data-hidden={hiddenIds.includes(tile.id) ? "1" : undefined}
              data-free={tile.free ? "true" : "false"}
              data-tier={tile.tier}
              data-testid={`tu-tile-${tile.id}`}
              disabled={!tile.free || snap.over || hiddenIds.includes(tile.id)}
              aria-label={fill(tile.free ? t.tileLabel : t.tileCovered, { name: names(tile.tier) })}
              style={{ left: (tile.x - minX) * u, top: (tile.y - minY) * u, width: u, height: u }}
              onClick={(e) => tapTile(tile.id, e.currentTarget)}
            >
              <TileFace tier={tiers[tile.tier]} />
            </button>
          ))}
          {snap.over && onShowResult ? (
            <button
              type="button"
              className="absolute inset-0 z-40"
              aria-label={copy.customer.game.barScore}
              data-testid="tu-board-result"
              onClick={onShowResult}
            />
          ) : null}
        </div>
        {view.banner ? (
          <p key={view.banner.k} className="tu-banner font-display pointer-events-none absolute inset-x-0 top-1/3 m-0 text-center text-[40px] text-c-ink" role="status" data-testid="tu-banner">
            {fill(t.batch, { n: String(view.banner.n) })}
          </p>
        ) : null}
      </div>

      <div className="relative shrink-0 px-2 pt-2 pb-[calc(10px+env(safe-area-inset-bottom))]">
        {view.toast ? (
          <p key={view.toast.k} className="tu-toast font-display pointer-events-none absolute inset-x-0 -top-9 z-40 m-0 text-center text-base text-c-ink" role="status" data-testid="tu-toast">
            <span className="rounded-full bg-c-paper px-3 py-1 shadow-[0_0_0_1px_var(--c-line)]">{view.toast.text}</span>
          </p>
        ) : null}
        <div className="mb-2 flex justify-center gap-5" role="group" aria-label={t.propsLabel} data-testid="tu-props">
          {PROP_KINDS.map((k) => {
            const n = view.props[k];
            const off = n <= 0 || snap.over || (k === "bag" && view.bagSize >= 7) || (k === "peek" && peeking);
            return (
              <button
                key={k}
                type="button"
                disabled={off}
                onClick={() => spendProp(k)}
                aria-label={fill(propLabel[k], { n: String(n) })}
                className="relative grid size-11 place-items-center rounded-full border border-c-line bg-c-paper text-c-ink disabled:opacity-35"
                data-testid={`tu-prop-${k}`}
                data-left={n}
              >
                <PropIcon kind={k} />
                <b className="font-num absolute -top-1 -right-1 grid min-w-[18px] place-items-center rounded-full bg-c-ink px-1 text-[11px] leading-[18px] font-normal text-c-paper" data-testid={`tu-prop-count-${k}`} aria-hidden="true">
                  {n}
                </b>
              </button>
            );
          })}
        </div>
        {view.flash ? (
          <p key={view.flash.k} className="tu-float font-num pointer-events-none absolute left-1/2 top-0 z-40 m-0 text-2xl text-c-ink" data-testid="tu-flash">
            {view.flash.text}
          </p>
        ) : null}
        <div
          ref={bagRef}
          className="tu-bag px-2.5 pt-5 pb-3"
          role="img"
          aria-label={fill(t.bagLabel, { n: String(view.bag.length), slots: String(view.bagSize) })}
          data-testid="tu-bag"
          data-full={full ? "1" : undefined}
        >
          <div className="tu-bag-bg" style={{ clipPath: zigzag }} aria-hidden="true" />
          <div className="relative z-10 flex justify-center" style={{ gap: slotGap }}>
            {Array.from({ length: view.bagSize }, (_, i) => {
              const tier = view.bag[i];
              const isArrive = view.arrive?.slot === i;
              return (
                <div key={i} className={i === 6 ? "tu-slot tu-slot-extra" : "tu-slot"} style={{ width: slotPx, height: slotPx }} data-testid={`tu-slot-${i}`} data-tier={tier ?? undefined}>
                  {tier !== undefined ? (
                    <span
                      className={`tu-tile ${view.popping.includes(i) ? "tu-popping" : ""} ${isArrive ? "tu-arrive" : ""}`}
                      data-slot-tile={i}
                      data-free="true"
                    >
                      <TileFace tier={tiers[tier]} />
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

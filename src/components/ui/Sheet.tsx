"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { EASE, EASE_IN, done, play } from "@/components/customer/bag/anim";
import { bindDrag } from "@/components/customer/rack/drag";
import { Spring } from "@/lib/motion";
import { useMotionPrefs } from "@/lib/motion/react";
import { pushOverlay } from "@/lib/overlayHistory";

/** Bottom sheet closes when pulled down this far (px) ... */
const DISMISS_DISTANCE = 110;
/** ... or released faster than this (px/ms). */
const DISMISS_SPEED = 0.5;
const OUT_MS = 300;

/** Backdrop of every sheet and dialog: the ink at 40%. */
export const sheetBackdropClass = "bg-[color-mix(in_srgb,var(--c-ink)_40%,transparent)]";

export interface SheetHandle {
  /** Plays the closing animation, then calls `onClosed`. */
  close(): void;
  /**
   * Gives up the browser-history entry (the owner is about to navigate away). Resolves once the
   * browser has actually stepped back, so a navigation started afterwards cannot be undone by it.
   */
  releaseHistory(): Promise<void>;
  readonly panel: HTMLElement | null;
  readonly backdrop: HTMLElement | null;
}

export interface SheetProps {
  /** Accessible name; or `labelledBy` / `describedBy` ids of elements inside. */
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  /** Called after the closing animation: the owner unmounts the sheet. */
  onClosed: () => void;
  /** Esc, a tap on the backdrop and a pull down close it (default true). */
  dismissible?: boolean;
  /** Browser Back closes it first (D90). */
  history?: boolean;
  /** Focused when it opens. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Made `inert` while the sheet is open (the page behind a dialog). */
  inertRef?: RefObject<HTMLElement | null>;
  /** Extra classes of the white panel (max height, padding). */
  className?: string;
  panelTestId?: string;
  backdropTestId?: string;
  children: ReactNode;
}

/** The panel slide-up as a spring (1.8 Hz, 0.7) sampled at 60 Hz into keyframes. */
function springKeyframes(): Keyframe[] {
  const s = new Spring(100, { frequencyHz: 1.8, dampingRatio: 0.7 });
  s.target = 0;
  const kf: Keyframe[] = [];
  for (let i = 0; i < 120; i++) {
    kf.push({ transform: `translateY(${s.x.toFixed(2)}%)` });
    s.step(1 / 60);
    if (s.isAtRest()) break;
  }
  kf.push({ transform: "none" });
  return kf;
}

const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * The one bottom sheet of the customer pages (bag, cancel confirmation, save-link dialog): a
 * backdrop and a white panel, rounded on top, that springs in and slides out (300 ms ease-in).
 * Locks the page scroll, keeps focus inside (Tab and Shift+Tab always wrap, also in Safari),
 * closes with Esc, a tap on the backdrop or a pull down (more than 110 px, or faster than
 * 0.5 px/ms) unless `dismissible` is false, and with `history` Back closes it first.
 * Rendered in a portal on document.body.
 */
export const Sheet = forwardRef<SheetHandle, SheetProps>(function Sheet(
  {
    label,
    labelledBy,
    describedBy,
    onClosed,
    dismissible = true,
    history = false,
    initialFocus,
    inertRef,
    className = "",
    panelTestId,
    backdropTestId,
    children,
  },
  ref,
) {
  const { reduced } = useMotionPrefs();
  const panelRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const releaseRef = useRef<(() => void) | null>(null);
  const onClosedRef = useRef(onClosed);
  const reducedRef = useRef(reduced);
  useEffect(() => {
    onClosedRef.current = onClosed;
    reducedRef.current = reduced;
  }, [onClosed, reduced]);

  const releaseHistory = useCallback((): Promise<void> => {
    const release = releaseRef.current;
    releaseRef.current = null;
    if (!release) return Promise.resolve();
    // close() steps the history back only while the sheet's own entry is the current one (it
    // carries the overlay marker). Then wait for that traversal; otherwise there is nothing to wait for.
    const state = window.history.state as Record<string, unknown> | null;
    const willStepBack = !!state && typeof state === "object" && "bbOverlay" in state;
    if (!willStepBack) {
      release();
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const finish = () => {
        window.removeEventListener("popstate", finish);
        clearTimeout(safety);
        resolve();
      };
      // Safety net only: a popstate that never comes must not keep the page from navigating.
      const safety = setTimeout(finish, 1000);
      window.addEventListener("popstate", finish);
      release();
    });
  }, []);

  const close = useCallback(
    (fromHistory = false) => {
      if (closing.current) return;
      closing.current = true;
      if (!fromHistory) void releaseHistory();
      const panel = panelRef.current;
      // A pull may have left the panel part-way down: the exit starts from there.
      const from = panel?.style.transform || "none";
      const reduce = reducedRef.current;
      play(backdropRef.current, [{ opacity: 1 }, { opacity: 0 }], { duration: OUT_MS, fill: "forwards" }, reduce);
      const a = play(
        panel,
        [
          { transform: from, opacity: 1 },
          { transform: "translateY(105%)", opacity: 0 },
        ],
        { duration: OUT_MS, easing: EASE_IN, fill: "forwards" },
        reduce,
      );
      void done(a).then(() => onClosedRef.current());
    },
    [releaseHistory],
  );

  useImperativeHandle(
    ref,
    () => ({
      close: () => close(),
      releaseHistory,
      get panel() {
        return panelRef.current;
      },
      get backdrop() {
        return backdropRef.current;
      },
    }),
    [close, releaseHistory],
  );

  // Opening: backdrop fade, spring slide (reduced motion: just a fade), focus.
  useEffect(() => {
    const reduce = reducedRef.current;
    const fade = play(backdropRef.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 250 }, reduce);
    let slide: Animation | null;
    if (reduce) {
      slide = play(panelRef.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 150 }, true);
    } else {
      const kf = springKeyframes();
      slide = play(panelRef.current, kf, { duration: kf.length * (1000 / 60), easing: "linear" }, false);
    }
    const focus = setTimeout(() => {
      const target = initialFocus?.current ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      target?.focus({ preventScroll: true });
    }, 50);
    return () => {
      clearTimeout(focus);
      fade?.cancel();
      slide?.cancel();
    };
    // The opening plays once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Page scroll lock (keeps the layout from jumping when the scrollbar goes away).
  useEffect(() => {
    const { overflow, paddingRight } = document.body.style;
    const bar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (bar > 0) document.body.style.paddingRight = `${bar}px`;
    return () => {
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
    };
  }, []);

  // The page behind a dialog is inert.
  useEffect(() => {
    const background = inertRef?.current;
    background?.setAttribute("inert", "");
    return () => background?.removeAttribute("inert");
  }, [inertRef]);

  // Browser Back closes the sheet first. Registered a tick late so React's dev double-mount does
  // not push, undo and push again.
  useEffect(() => {
    if (!history) return;
    const timer = setTimeout(() => {
      releaseRef.current = pushOverlay(() => close(true));
    }, 0);
    return () => {
      clearTimeout(timer);
      void releaseHistory();
    };
  }, [history, close, releaseHistory]);

  // Esc and the focus trap. Document-level, so the trap also holds when focus has slipped to
  // <body> (a tap on the backdrop). Tab is always moved by hand: Safari's default order skips buttons.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (dismissible) close();
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (n) => n.offsetParent !== null || n === document.activeElement,
      );
      if (nodes.length === 0) return;
      e.preventDefault();
      const at = nodes.findIndex((n) => n === document.activeElement);
      const next = e.shiftKey ? (at <= 0 ? nodes.length - 1 : at - 1) : at < 0 || at === nodes.length - 1 ? 0 : at + 1;
      nodes[next].focus();
    }
    function onFocusIn(e: FocusEvent) {
      if (e.target instanceof Node && !panelRef.current?.contains(e.target)) {
        (initialFocus?.current ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE))?.focus({ preventScroll: true });
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [dismissible, close, initialFocus]);

  // Pull down to dismiss. Starts anywhere on the panel except `[data-no-sheet-drag]` (the shakeable
  // bag) and, inside a `[data-sheet-scroll]` list, only once that list is scrolled to its top.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || !dismissible) return;
    let startTarget: Element | null = null;
    let base: number | null = null;
    let samples: { y: number; t: number }[] = [];
    return bindDrag(panel, {
      axis: "y",
      canStart: (target) => !target?.closest("[data-no-sheet-drag]") && !closing.current,
      onStart(_x, _y, target) {
        startTarget = target;
        base = null;
        samples = [];
      },
      shouldClaim(_dx, dy) {
        if (dy <= 0) return false;
        const scroller = startTarget?.closest("[data-sheet-scroll]") as HTMLElement | null;
        return !scroller || scroller.scrollTop <= 0;
      },
      onDrag(_dx, dy, t) {
        // The pull starts counting where it was claimed (a list scrolled to its top mid-gesture).
        if (base === null) base = dy;
        const pull = Math.max(0, dy - base);
        samples.push({ y: pull, t });
        panel.style.transform = pull > 0 ? `translateY(${pull}px)` : "";
        const h = panel.offsetHeight || 1;
        if (backdropRef.current) backdropRef.current.style.opacity = String(Math.max(0.2, 1 - (pull / h) * 0.8));
      },
      onEnd(end) {
        const pull = samples.length ? samples[samples.length - 1].y : 0;
        const last = samples[samples.length - 1];
        const from = samples.find((s) => last && s.t >= last.t - 100) ?? last;
        // A finger that paused before lifting is not a fling.
        const paused = !last || performance.now() - last.t > 80;
        const speed = !paused && last && from && last.t > from.t ? (last.y - from.y) / (last.t - from.t) : 0;
        const wasPulled = end.dragged && !end.cancelled && pull > 0;
        if (wasPulled && (pull > DISMISS_DISTANCE || speed > DISMISS_SPEED)) {
          if (backdropRef.current) backdropRef.current.style.opacity = "";
          close();
          return;
        }
        // Not far enough: spring back.
        const current = panel.style.transform;
        panel.style.transform = "";
        if (backdropRef.current) backdropRef.current.style.opacity = "";
        if (current) {
          play(panel, [{ transform: current }, { transform: "none" }], { duration: 300, easing: EASE }, reducedRef.current);
        }
      },
    });
  }, [dismissible, close]);

  const tree = (
    <>
      <div
        ref={backdropRef}
        className={`fixed inset-0 z-50 ${sheetBackdropClass}`}
        style={{ touchAction: "none" }}
        // A tap on a dialog that cannot be dismissed must not pull focus out of it.
        onMouseDown={dismissible ? undefined : (e) => e.preventDefault()}
        onClick={dismissible ? () => close() : undefined}
        data-testid={backdropTestId}
      />
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className={`fixed inset-x-0 bottom-0 z-[51] mx-auto flex max-w-[430px] flex-col rounded-t-[28px] bg-c-paper text-c-ink ${className}`}
        data-testid={panelTestId}
      >
        {children}
      </section>
    </>
  );
  // Sheets only ever open on the client; without a document (static rendering in unit tests) the
  // tree is returned in place.
  return typeof document === "undefined" ? tree : createPortal(tree, document.body);
});

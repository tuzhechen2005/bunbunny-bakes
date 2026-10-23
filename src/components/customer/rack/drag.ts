/**
 * One-finger drag binding for the home hero and the detail pull-down (D77).
 *
 * Touch: native `touchstart` (passive) / `touchmove` (NOT passive) / `touchend` / `touchcancel`
 * listeners, because React's synthetic handlers and pointer events lose horizontal drags to the
 * page and to host apps such as WeChat. The axis is decided on the first move past `lockPx`
 * (horizontal when |dx| >= bias * |dy|); a gesture that belongs to this binding gets
 * `preventDefault()` on every `touchmove`, a vertical one is left to the page scroll.
 *
 * Mouse and pen: pointer events (touch pointers are ignored so a finger is never handled twice).
 */
import { GestureTracker, type Axis } from "@/lib/motion/gesture";

export interface DragEnd {
  /** True once the gesture was claimed by this binding (moved along `axis`). */
  dragged: boolean;
  /** The decided axis, null when the finger never moved `lockPx` (a tap). */
  axis: Axis | null;
  /** touchcancel, a second finger, or the pointer was cancelled: do not fling. */
  cancelled: boolean;
  /** Element the gesture started on. */
  target: Element | null;
  dx: number;
  dy: number;
  /** Release velocity along x (px/ms), see GestureTracker.end. */
  velocity: number;
  fling: -1 | 0 | 1;
  /** Gesture length in ms. */
  duration: number;
}

export interface DragOptions {
  /** The axis this binding wants. The other axis is left to the page. */
  axis: Axis;
  /** Horizontal when |dx| >= bias * |dy|. Default 1. */
  horizontalBias?: number;
  /** Distance at which the axis is decided. Default 4 px: tolerant of tap jitter, early enough to claim a swipe. */
  lockPx?: number;
  /** Return false to ignore a gesture (started on a button, wrong mode, ...). */
  canStart(target: Element | null, kind: "touch" | "mouse"): boolean;
  onStart?(x: number, y: number, target: Element | null): void;
  /** While the gesture is claimed: displacement from the start. */
  onDrag(dx: number, dy: number, t: number): void;
  onEnd(end: DragEnd): void;
  /** Touch only: decide per move whether to keep the page from scrolling. Default: always when claimed. */
  shouldClaim?(dx: number, dy: number): boolean;
}

export function bindDrag(el: HTMLElement, opts: DragOptions): () => void {
  const tracker = new GestureTracker({ lockPx: opts.lockPx ?? 4, horizontalBias: opts.horizontalBias ?? 1 });
  let kind: "touch" | "mouse" | null = null;
  let id: number | null = null;
  let x0 = 0;
  let y0 = 0;
  let t0 = 0;
  let dx = 0;
  let dy = 0;
  let dragged = false;
  let startTarget: Element | null = null;

  function begin(k: "touch" | "mouse", pid: number, x: number, y: number, t: number, target: Element | null) {
    kind = k;
    id = pid;
    x0 = x;
    y0 = y;
    t0 = t;
    dx = dy = 0;
    dragged = false;
    startTarget = target;
    tracker.start(x, y, t);
    opts.onStart?.(x, y, target);
  }

  /** Returns true when the gesture is (now) claimed by this binding. */
  function move(x: number, y: number, t: number): boolean {
    tracker.move(x, y, t);
    dx = x - x0;
    dy = y - y0;
    if (tracker.axis !== opts.axis) return false;
    // A pull may refuse some moves (e.g. upwards); it only becomes `dragged` once it accepts one.
    if (opts.shouldClaim && !dragged && !opts.shouldClaim(dx, dy)) return false;
    dragged = true;
    opts.onDrag(dx, dy, t);
    return true;
  }

  function finish(t: number, cancelled: boolean) {
    if (kind === null) return;
    const res = tracker.end(t);
    const out: DragEnd = {
      dragged,
      axis: tracker.axis,
      cancelled,
      target: startTarget,
      dx,
      dy,
      velocity: cancelled ? 0 : res.velocity,
      fling: cancelled ? 0 : res.fling,
      duration: t - t0,
    };
    kind = null;
    id = null;
    dragged = false;
    tracker.cancel();
    opts.onEnd(out);
  }

  // ---- touch ----
  const onTouchStart = (e: TouchEvent) => {
    if (kind === "touch") {
      // A second finger: give the gesture up so nothing half-finished is flung.
      finish(e.timeStamp, true);
      return;
    }
    if (e.touches.length > 1) return;
    const target = e.target instanceof Element ? e.target : null;
    if (!opts.canStart(target, "touch")) return;
    const t = e.changedTouches[0];
    begin("touch", t.identifier, t.clientX, t.clientY, e.timeStamp, target);
  };
  const find = (list: TouchList): Touch | null => {
    for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
    return null;
  };
  const onTouchMove = (e: TouchEvent) => {
    if (kind !== "touch") return;
    const t = find(e.changedTouches);
    if (!t) return;
    move(t.clientX, t.clientY, e.timeStamp);
    // Once claimed, every move is ours: the page must not start scrolling halfway through.
    if (dragged && e.cancelable) e.preventDefault();
  };
  const onTouchEnd = (e: TouchEvent) => {
    if (kind !== "touch" || !find(e.changedTouches)) return;
    finish(e.timeStamp, false);
  };
  const onTouchCancel = (e: TouchEvent) => {
    if (kind !== "touch" || !find(e.changedTouches)) return;
    finish(e.timeStamp, true);
  };

  // ---- mouse / pen ----
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === "touch" || e.button !== 0 || kind !== null) return;
    const target = e.target instanceof Element ? e.target : null;
    if (!opts.canStart(target, "mouse")) return;
    begin("mouse", e.pointerId, e.clientX, e.clientY, e.timeStamp, target);
  };
  let captured = false;
  const onPointerMove = (e: PointerEvent) => {
    if (kind !== "mouse" || e.pointerId !== id) return;
    if (move(e.clientX, e.clientY, e.timeStamp) && !captured) {
      captured = true;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* capture is a nicety: dragging off the element keeps working without it */
      }
    }
  };
  const onPointerUp = (e: PointerEvent) => {
    if (kind !== "mouse" || e.pointerId !== id) return;
    captured = false;
    finish(e.timeStamp, false);
  };
  const onPointerCancel = (e: PointerEvent) => {
    if (kind !== "mouse" || e.pointerId !== id) return;
    captured = false;
    finish(e.timeStamp, true);
  };

  el.addEventListener("touchstart", onTouchStart, { passive: true });
  el.addEventListener("touchmove", onTouchMove, { passive: false });
  el.addEventListener("touchend", onTouchEnd);
  el.addEventListener("touchcancel", onTouchCancel);
  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerCancel);
  return () => {
    el.removeEventListener("touchstart", onTouchStart);
    el.removeEventListener("touchmove", onTouchMove);
    el.removeEventListener("touchend", onTouchEnd);
    el.removeEventListener("touchcancel", onTouchCancel);
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", onPointerUp);
    el.removeEventListener("pointercancel", onPointerCancel);
  };
}

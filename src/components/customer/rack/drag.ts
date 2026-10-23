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
  /** Longest distance from the start point during the gesture (px): a tap is a gesture with little travel. */
  travel: number;
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
  let travel = 0;
  let startTarget: Element | null = null;

  function begin(k: "touch" | "mouse", pid: number, x: number, y: number, t: number, target: Element | null) {
    kind = k;
    id = pid;
    x0 = x;
    y0 = y;
    t0 = t;
    dx = dy = 0;
    travel = 0;
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
    travel = Math.max(travel, Math.hypot(dx, dy));
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
      travel,
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
  // Touch events keep going to the element the finger landed on, even after that element has left
  // the document (React replaces nodes mid-gesture, e.g. the swapping bread name). Listening on the
  // hero alone would lose the touchend of such a gesture, so the move / end / cancel listeners sit on
  // the touchstart target itself for the lifetime of the gesture.
  let touchTarget: Element | null = null;
  const find = (list: TouchList): Touch | null => {
    for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
    return null;
  };
  const detachTouch = () => {
    if (!touchTarget) return;
    touchTarget.removeEventListener("touchmove", onTouchMove as EventListener);
    touchTarget.removeEventListener("touchend", onTouchEnd as EventListener);
    touchTarget.removeEventListener("touchcancel", onTouchCancel as EventListener);
    touchTarget = null;
  };
  function onTouchMove(e: TouchEvent) {
    if (kind !== "touch") return;
    const t = find(e.changedTouches);
    if (!t) return;
    move(t.clientX, t.clientY, e.timeStamp);
    // Once claimed, every move is ours: the page must not start scrolling halfway through.
    if (dragged && e.cancelable) e.preventDefault();
  }
  function onTouchEnd(e: TouchEvent) {
    if (kind !== "touch" || !find(e.changedTouches)) return;
    detachTouch();
    finish(e.timeStamp, false);
  }
  function onTouchCancel(e: TouchEvent) {
    if (kind !== "touch" || !find(e.changedTouches)) return;
    detachTouch();
    finish(e.timeStamp, true);
  }
  const onTouchStart = (e: TouchEvent) => {
    if (kind === "touch") {
      // A gesture is still open. Either a second finger arrived (give the gesture up so nothing
      // half-finished is flung), or its touchend never came (the old finger is gone): in that case
      // close the stale gesture and let this touch start a fresh one.
      detachTouch();
      finish(e.timeStamp, true);
      if (e.touches.length > 1) return;
    }
    if (e.touches.length > 1) return;
    const target = e.target instanceof Element ? e.target : null;
    if (!target || !opts.canStart(target, "touch")) return;
    const t = e.changedTouches[0];
    touchTarget = target;
    target.addEventListener("touchmove", onTouchMove as EventListener, { passive: false });
    target.addEventListener("touchend", onTouchEnd as EventListener);
    target.addEventListener("touchcancel", onTouchCancel as EventListener);
    begin("touch", t.identifier, t.clientX, t.clientY, e.timeStamp, target);
  };

  // ---- mouse / pen ----
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === "touch" || e.button !== 0 || kind !== null) return;
    const target = e.target instanceof Element ? e.target : null;
    if (!opts.canStart(target, "mouse")) return;
    begin("mouse", e.pointerId, e.clientX, e.clientY, e.timeStamp, target);
    // The button may be released anywhere (off the 430 px column, over another element) before the
    // gesture is captured: listen on the window so the gesture always ends.
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  };
  const detachMouse = () => {
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
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
  function onPointerUp(e: PointerEvent) {
    if (kind !== "mouse" || e.pointerId !== id) return;
    captured = false;
    detachMouse();
    finish(e.timeStamp, false);
  }
  function onPointerCancel(e: PointerEvent) {
    if (kind !== "mouse" || e.pointerId !== id) return;
    captured = false;
    detachMouse();
    finish(e.timeStamp, true);
  }

  el.addEventListener("touchstart", onTouchStart, { passive: true });
  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  return () => {
    el.removeEventListener("touchstart", onTouchStart);
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    detachTouch();
    detachMouse();
  };
}

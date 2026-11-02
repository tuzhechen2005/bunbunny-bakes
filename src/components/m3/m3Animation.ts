import { BIG_BASE, EMPTY, ROLL_BASE, tierOf, type M3Cell, type M3Event, type M3State } from "@/lib/m3";

export type SwipeDirection = "up" | "down" | "left" | "right";
/** Called once, on the first nonzero movement; callers retain the result until touchend. */
export function swipeDirection(dx: number, dy: number): SwipeDirection | null {
  if (!dx && !dy) return null;
  return Math.abs(dx) > Math.abs(dy) ? dx < 0 ? "left" : "right" : dy < 0 ? "up" : "down";
}
export function swipeTarget(a: M3Cell, direction: SwipeDirection): M3Cell | null {
  const r = a.r + (direction === "down" ? 1 : direction === "up" ? -1 : 0);
  const c = a.c + (direction === "right" ? 1 : direction === "left" ? -1 : 0);
  return r >= 0 && r < 8 && c >= 0 && c < 8 ? { r, c } : null;
}
export const sameCell = (a: M3Cell | null, b: M3Cell) => a?.r === b.r && a.c === b.c;
export const adjacent = (a: M3Cell, b: M3Cell) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
export interface AnimationFrame { index: number; event: M3Event; before: M3State; after: M3State; ms: number }
const durations: Record<M3Event["type"], number> = { swap: 180, match: 190, special: 180, fall: 200, refill: 200, order: 100, shuffle: 250, over: 0 };
const clone = (s: M3State): M3State => ({ ...s, board: s.board.map(row => [...row]), orders: s.orders.map(o => ({ ...o })) as M3State["orders"], specials: s.specials.map(p => ({ ...p })) });
/** Detached frames preserve engine ordering, including order bonuses before gravity. */
export function animationQueue(initial: M3State, events: M3Event[]): AnimationFrame[] {
  let state = clone(initial);
  return events.map((event, index) => {
    const before = state;
    const after = clone(before);
    switch (event.type) {
      case "swap": {
        const { a, b } = event;
        [after.board[a.r][a.c], after.board[b.r][b.c]] = [after.board[b.r][b.c], after.board[a.r][a.c]];
        after.movesLeft--;
        break;
      }
      case "match":
        event.cells.forEach(p => { after.board[p.r][p.c] = EMPTY; });
        after.score += event.points;
        break;
      case "special":
        if (event.action !== "fired") after.board[event.cell.r][event.cell.c] = (event.kind === "big" ? BIG_BASE : ROLL_BASE) + event.tier;
        break;
      case "fall":
        event.tiles.forEach(({ from, to, code }) => { after.board[from.r][from.c] = EMPTY; after.board[to.r][to.c] = code; });
        break;
      case "refill":
        event.tiles.forEach(p => { after.board[p.r][p.c] = p.code; });
        break;
      case "order":
        after.orders[event.index] = { ...event.order };
        if (event.action === "complete") after.score += event.order.points;
        break;
      case "shuffle": after.board = event.board.map(row => [...row]); break;
      case "over": after.over = true; break;
    }
    after.specials = after.board.flatMap((row, r) => row.flatMap((v, c) => v >= ROLL_BASE ? [{ r, c, kind: v >= BIG_BASE ? "big" as const : "roll" as const, tier: tierOf(v) }] : []));
    state = after;
    return { index, event, before, after, ms: event.type === "order" && event.action === "complete" ? 320 : durations[event.type] };
  });
}

/** One move's whole animation aims for this (D184: roughly 2–3 s; points never depend on it). */
export const CASCADE_BUDGET_MS = 2600;
const MIN_FRAME_MS = 30;
const MIN_ORDER_FRAME_MS = 120;
const WAVE_DECAY = 0.78;
/**
 * Long cascades play the first wave (through the first special trigger) at full length, then each later
 * wave faster than the one before, scaled down so the whole queue fits the budget. Short moves are
 * returned unchanged. Only `ms` changes: every event, frame and score is kept.
 */
export function paceQueue(queue: AnimationFrame[], budget = CASCADE_BUDGET_MS): AnimationFrame[] {
  if (queue.reduce((sum, f) => sum + f.ms, 0) <= budget) return queue;
  // A wave starts at the first match/special after the previous wave's gravity and refill.
  let wave = 0;
  let fell = false;
  const waves = queue.map(f => {
    const type = f.event.type;
    if (type === "match" || type === "special") {
      if (fell) { wave++; fell = false; }
    } else if (type === "fall" || type === "refill") fell = true;
    return wave;
  });
  // Wave 0 (the swap and first match) and the wave of the first special trigger play in full.
  const firstSpecial = queue.findIndex(f => f.event.type === "special");
  const special = firstSpecial < 0 ? 0 : waves[firstSpecial];
  const full = (i: number) => waves[i] === 0 || waves[i] === special;
  const weight = (i: number) => full(i) ? 1 : WAVE_DECAY ** waves[i];
  const keptMs = queue.reduce((sum, f, i) => sum + (full(i) ? f.ms : 0), 0);
  const laterMs = queue.reduce((sum, f, i) => sum + (full(i) ? 0 : f.ms * weight(i)), 0);
  const scale = laterMs > 0 ? Math.min(1, Math.max(0, budget - keptMs) / laterMs) : 1;
  return queue.map((f, i) => {
    if (full(i)) return f;
    const floor = f.event.type === "order" && f.event.action === "complete" ? MIN_ORDER_FRAME_MS : MIN_FRAME_MS;
    return { ...f, ms: Math.min(f.ms, Math.max(floor, Math.round(f.ms * weight(i) * scale))) };
  });
}

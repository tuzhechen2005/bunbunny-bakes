import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { M3Page } from "@/components/m3/M3Page";
import { M3Board, type M3Progress } from "@/components/m3/M3Board";
import { finishM3 } from "@/components/m3/m3Api";
import { readM3Save, writeM3Save, type M3Save } from "@/components/m3/m3Save";
import { createM3Game, legalM3Moves, type M3Move } from "@/lib/m3";

// Exercise component callbacks in Node; browser specs cover reconciliation, focus and layout.
const hooks = vi.hoisted(() => {
  let cursor = 0;
  let slots: unknown[] = [];
  let effects: (() => void)[] = [];
  let cleanups: (() => void)[] = [];
  let dirty = false;
  const state = <T,>(initial: T | (() => T)) => {
    const i = cursor++;
    if (!(i in slots)) slots[i] = typeof initial === "function" ? (initial as () => T)() : initial;
    return [slots[i] as T, (next: T | ((old: T) => T)) => {
      const value = typeof next === "function" ? (next as (old: T) => T)(slots[i] as T) : next;
      if (!Object.is(value, slots[i])) dirty = true;
      slots[i] = value;
    }] as const;
  };
  const effect = (fn: () => void | (() => void), deps?: unknown[]) => {
    const i = cursor++;
    const old = slots[i] as unknown[] | undefined;
    if (!deps || !old || deps.some((v, n) => !Object.is(v, old[n]))) {
      slots[i] = deps;
      effects.push(() => { cleanups[i]?.(); cleanups[i] = fn() || (() => {}); });
    }
  };
  return {
    state, effect,
    ref: <T,>(value: T) => state(() => ({ current: value }))[0],
    render<T>(fn: () => T, attach?: (tree: T) => void): T {
      let tree: T;
      do {
        dirty = false; cursor = 0; tree = fn(); attach?.(tree);
        const pending = effects; effects = []; pending.forEach(fn => fn());
      } while (dirty);
      return tree;
    },
    reset() { cleanups.forEach(fn => fn?.()); slots = []; effects = []; cleanups = []; cursor = 0; dirty = false; },
  };
});
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useState: hooks.state, useRef: hooks.ref, useEffect: hooks.effect, useLayoutEffect: hooks.effect,
  useCallback: (fn: unknown) => fn,
}));
vi.mock("@/lib/motion/react", () => ({ useMotionPrefs: () => ({ reduced: true, degraded: false }), haptic: vi.fn() }));
vi.mock("@/components/game/useLiveProgress", () => ({ useLiveProgress: vi.fn() }));
vi.mock("@/components/game/useGameHub", () => ({ useGameHub: () => ({ data: null }) }));
vi.mock("@/lib/api", () => ({ fetchMenu: async () => ({ ok: false }) }));
vi.mock("@/components/m3/m3Api", () => ({ finishM3: vi.fn(), startM3: vi.fn(), fetchM3Leaderboard: vi.fn() }));
vi.mock("@/components/ui/TopBar", () => ({ TopBar: "top-bar" }));
vi.mock("@/components/ui/Sheet", () => ({ Sheet: "sheet" }));
vi.mock("@/components/game/LeaderboardView", () => ({ LeaderboardView: "leaderboard" }));

interface Props {
  children?: ReactNode; right?: ReactNode; "data-testid"?: string; panelTestId?: string;
  onClick?: () => void; onClosed?: () => void;
  onOver?: (p: M3Progress) => void;
  ref?: { current: unknown };
}
function nodes(tree: ReactNode): Props[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<Props>(tree)) return [];
  return [tree.props, ...nodes(tree.props.children), ...nodes(tree.props.right)];
}
function target(tree: ReactNode, id: string) {
  const found = nodes(tree).find(p => p["data-testid"] === id || p.panelTestId === id);
  if (!found) throw new Error(`Missing ${id}`);
  return found;
}
const tiers = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, radius: .1, points: 10, imageUrl: null, color: { bg: "var(--c-wash)", ink: "var(--c-ink)" } }));
function completedSave(): M3Save {
  const game = createM3Game({ seed: "save", tiers });
  const moves: M3Move[] = [];
  while (!game.over) {
    const m = legalM3Moves(game.state())[0];
    game.swap(m.a, m.b); moves.push({ ...m, at: moves.length * 500 });
  }
  return { v: 1, runId: "pending-run", seed: "save", tiers, moves, score: game.score, nickname: "baker", expiresAt: "2099-01-01" };
}
beforeEach(() => {
  vi.useFakeTimers();
  const data = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: {
    get length() { return data.size; }, key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v), removeItem: (k: string) => data.delete(k),
  } });
  vi.mocked(finishM3).mockReset().mockReturnValue(new Promise(() => {}));
});
afterEach(() => { hooks.reset(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function resume() {
  let tree = hooks.render(M3Page);
  target(tree, "m3-resume").onClick!();
  tree = hooks.render(M3Page);
  return tree;
}
describe("M3 finish handoff", () => {
  it.each([false, true])("releases Exit and invalidates queued discard before results (closing=%s)", async closing => {
    const saved = completedSave(); writeM3Save(saved);
    let tree = resume();
    target(tree, "m3-exit").onClick!(); tree = hooks.render(M3Page);
    const exit = target(tree, "m3-exit-sheet");
    if (closing) target(tree, "m3-exit-discard").onClick!();
    nodes(tree).find(p => p.onOver)!.onOver!(saved);
    tree = hooks.render(M3Page);
    expect(nodes(tree).filter(p => p.panelTestId === "m3-exit-sheet")).toHaveLength(0);
    // A Sheet closing animation can resolve after the parent forcibly unmounts it.
    exit.onClosed!();
    await vi.runOnlyPendingTimersAsync(); tree = hooks.render(M3Page);
    expect(target(tree, "m3-over-sheet")).toBeDefined();
    expect(readM3Save()).toEqual(saved);
    expect(finishM3).toHaveBeenCalledExactlyOnceWith(saved.runId, saved.moves);
  });

  it("retains a completed log through failure/reload and clears it only on acknowledgment", async () => {
    const saved = completedSave(); writeM3Save(saved);
    vi.mocked(finishM3).mockResolvedValueOnce({ ok: false, status: 0, error: { error: "NETWORK", message: "offline" } });
    let tree = resume(); nodes(tree).find(p => p.onOver)!.onOver!(saved);
    await vi.runOnlyPendingTimersAsync(); tree = hooks.render(M3Page);
    expect(target(tree, "m3-retry")).toBeDefined();
    expect(readM3Save()).toEqual(saved);
    hooks.reset();
    vi.mocked(finishM3).mockResolvedValueOnce({ ok: true, status: 200, data: { score: saved.score, best: saved.score, rank: 1, week: { start: "2026-11-30", end: "2026-12-06" } } });
    tree = resume(); nodes(tree).find(p => p.onOver)!.onOver!(saved);
    await vi.runOnlyPendingTimersAsync(); hooks.render(M3Page);
    expect(finishM3).toHaveBeenLastCalledWith(saved.runId, saved.moves);
    expect(readM3Save()).toBeNull();
  });
});

describe("M3 abandoned touches", () => {
  it.each(["edge", "short", "cancel", "multitouch", "tap"])("resets selection for %s, preserving genuine taps", kind => {
    const board = Object.assign(new EventTarget(), { querySelectorAll: () => [] });
    const render = () => hooks.render(() => M3Board({ seed: "save", tiers, soundOn: false, reduced: true, onProgress: vi.fn(), onOver: vi.fn() }), tree => {
      target(tree, "m3-board").ref!.current = board;
    });
    let tree = render(); target(tree, "m3-cell-2-2").onClick!(); tree = render();
    const touch = (type: string, x: number, count = 1) => {
      const e = new Event(type, { cancelable: true });
      Object.defineProperties(e, {
        target: { value: { closest: () => ({ dataset: { cell: "0,0" } }) } },
        touches: { value: Array.from({ length: count }, () => ({ clientX: x, clientY: 0 })) },
      });
      board.dispatchEvent(e);
    };
    touch("touchstart", 30);
    if (kind === "edge") touch("touchmove", 0);
    if (kind === "short") touch("touchmove", 29);
    if (kind === "multitouch") touch("touchstart", 30, 2);
    touch(kind === "cancel" ? "touchcancel" : "touchend", 30, 0);
    tree = render();
    const selected = nodes(tree).filter(p => (p as Record<string, unknown>)["aria-pressed"] === true);
    expect(selected).toHaveLength(kind === "tap" ? 1 : 0);
  });
});

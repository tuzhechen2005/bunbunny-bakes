import { afterEach, expect, it, vi } from "vitest";
import { BOARD_REFRESH_MS } from "@/lib/liveScores";
import { useGameHub } from "@/components/game/useGameHub";

const mocks = vi.hoisted(() => ({ cleanups: [] as (() => void)[], call: vi.fn() }));
vi.mock("react", () => ({
  useEffect: (fn: () => (() => void) | undefined) => {
    const cleanup = fn(); if (cleanup) mocks.cleanups.push(cleanup);
  },
  useState: (value: unknown) => [value, vi.fn()],
  useCallback: (fn: unknown) => fn,
}));
vi.mock("@/components/game/gameApi", () => ({ call: mocks.call }));
afterEach(() => {
  mocks.cleanups.splice(0).forEach(fn => fn());
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks();
});

function setup() {
  vi.useFakeTimers();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const win = new EventTarget();
  vi.stubGlobal("document", doc); vi.stubGlobal("window", win);
  mocks.call.mockResolvedValue({ ok: true, data: { liveScores: true } });
  return { doc, win };
}

it("game pages and near home cards load once and on return, without polling", async () => {
  const { doc, win } = setup();
  useGameHub();
  useGameHub(true);
  await vi.advanceTimersByTimeAsync(BOARD_REFRESH_MS * 4);
  expect(mocks.call).toHaveBeenCalledTimes(2);
  win.dispatchEvent(new Event("focus"));
  expect(mocks.call).toHaveBeenCalledTimes(4);
  doc.visibilityState = "hidden";
  doc.dispatchEvent(new Event("visibilitychange"));
  expect(mocks.call).toHaveBeenCalledTimes(4);
  doc.visibilityState = "visible";
  doc.dispatchEvent(new Event("visibilitychange"));
  expect(mocks.call).toHaveBeenCalledTimes(6);
});

it("only an opted-in visible hub polls, and stops on cleanup", async () => {
  const { doc } = setup();
  useGameHub(true, { refresh: true });
  await vi.advanceTimersByTimeAsync(BOARD_REFRESH_MS);
  expect(mocks.call).toHaveBeenCalledTimes(2);
  doc.visibilityState = "hidden";
  await vi.advanceTimersByTimeAsync(BOARD_REFRESH_MS * 2);
  expect(mocks.call).toHaveBeenCalledTimes(2);
  doc.visibilityState = "visible";
  await vi.advanceTimersByTimeAsync(BOARD_REFRESH_MS);
  expect(mocks.call).toHaveBeenCalledTimes(3);
  mocks.cleanups.splice(0).forEach(fn => fn());
  await vi.advanceTimersByTimeAsync(BOARD_REFRESH_MS);
  expect(mocks.call).toHaveBeenCalledTimes(3);
});

it("does not load or poll a home card that is not near", async () => {
  setup(); useGameHub(false);
  await vi.advanceTimersByTimeAsync(BOARD_REFRESH_MS * 4);
  expect(mocks.call).not.toHaveBeenCalled();
});

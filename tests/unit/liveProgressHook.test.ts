import { afterEach, expect, it, vi } from "vitest";
import { PROGRESS_REPORT_MS } from "@/lib/liveScores";

const effects = vi.hoisted(() => ({ cleanups: [] as (() => void)[] }));
vi.mock("react", () => ({ useEffect: (fn: () => (() => void) | undefined) => {
  const cleanup = fn(); if (cleanup) effects.cleanups.push(cleanup);
} }));
afterEach(() => {
  effects.cleanups.splice(0).forEach(fn => fn());
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules();
});

async function setup() {
  vi.useFakeTimers();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const win = new EventTarget();
  vi.stubGlobal("document", doc); vi.stubGlobal("window", win);
  const fetch = vi.fn().mockResolvedValue({ status: 200 });
  vi.stubGlobal("fetch", fetch);
  const { useLiveProgress } = await import("@/components/game/useLiveProgress");
  return { doc, win, fetch, useLiveProgress };
}

it("reports full logs on timer, hidden, pagehide and in-page exit; no requests after cleanup", async () => {
  const { doc, win, fetch, useLiveProgress } = await setup();
  let log = [{ id: 1, at: 0 }];
  useLiveProgress("/api/game/tu/progress", true, () => ({ runId: "r", log }));
  await vi.advanceTimersByTimeAsync(PROGRESS_REPORT_MS);
  expect(fetch).toHaveBeenCalledTimes(1);
  log = [...log, { id: 2, at: 500 }];
  doc.visibilityState = "hidden"; doc.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(0);
  expect(JSON.parse(fetch.mock.calls[1][1].body).log).toEqual(log);
  expect(fetch.mock.calls[1][1].keepalive).toBe(true);
  win.dispatchEvent(new Event("pagehide"));
  await vi.advanceTimersByTimeAsync(0);
  effects.cleanups.splice(0).forEach(fn => fn());
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(4);
  win.dispatchEvent(new Event("pagehide")); doc.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(PROGRESS_REPORT_MS * 2);
  expect(fetch).toHaveBeenCalledTimes(4);
});

it("a first 404 disables subsequent reporters across all games", async () => {
  const { fetch, useLiveProgress } = await setup();
  fetch.mockResolvedValue({ status: 404 });
  useLiveProgress("/api/game/progress", true, () => ({ runId: "r", log: [] }));
  await vi.advanceTimersByTimeAsync(PROGRESS_REPORT_MS);
  effects.cleanups.splice(0).forEach(fn => fn());
  useLiveProgress("/api/game/m3/progress", true, () => ({ runId: "r2", log: [] }));
  await vi.advanceTimersByTimeAsync(PROGRESS_REPORT_MS * 3);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("does not report after game over and avoids the keepalive cap for long TU logs", async () => {
  const { fetch, win, useLiveProgress } = await setup();
  let over = false;
  const log = Array.from({ length: 20000 }, (_, i) => ({ id: i, at: i * 500 }));
  useLiveProgress("/api/game/tu/progress", true, () => over ? null : { runId: "r", log });
  win.dispatchEvent(new Event("pagehide"));
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch.mock.calls[0][1].keepalive).toBe(false);
  expect(JSON.parse(fetch.mock.calls[0][1].body).log).toHaveLength(20000);
  over = true;
  effects.cleanups.splice(0).forEach(fn => fn());
  await vi.advanceTimersByTimeAsync(PROGRESS_REPORT_MS * 2);
  expect(fetch).toHaveBeenCalledTimes(1);
});

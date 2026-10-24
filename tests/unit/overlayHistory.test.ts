import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A minimal browser history: pushState / back / popstate, enough for the overlay helper. */
function installFakeWindow() {
  const entries: unknown[] = [{ __NA: true }];
  let at = 0;
  const listeners: (() => void)[] = [];
  const history = {
    get state() {
      return entries[at];
    },
    pushState(state: unknown) {
      entries.splice(at + 1);
      entries.push(state);
      at++;
    },
    back() {
      if (at === 0) return;
      at--;
      // popstate is async in browsers
      queueMicrotask(() => listeners.forEach((l) => l()));
    },
  };
  const w = {
    history,
    addEventListener: (_: string, l: () => void) => listeners.push(l),
  };
  vi.stubGlobal("window", w);
  return { entries, at: () => at, w };
}

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("pushOverlay (Back closes the overlay first, D90)", () => {
  it("push adds one history entry and keeps the router's state", async () => {
    const h = installFakeWindow();
    const { pushOverlay } = await import("@/lib/overlayHistory");
    pushOverlay(() => {});
    expect(h.at()).toBe(1);
    expect(h.entries[1]).toMatchObject({ __NA: true, bbOverlay: 1 });
  });

  it("the browser going back calls onPop once and leaves no entry behind", async () => {
    const h = installFakeWindow();
    const { pushOverlay } = await import("@/lib/overlayHistory");
    const onPop = vi.fn();
    const close = pushOverlay(onPop);
    h.w.history.back();
    await flush();
    expect(onPop).toHaveBeenCalledTimes(1);
    expect(h.at()).toBe(0);
    // closing afterwards (the animation finished) must not go back again
    close();
    await flush();
    expect(h.at()).toBe(0);
    expect(onPop).toHaveBeenCalledTimes(1);
  });

  it("closing by button steps the entry back without calling onPop", async () => {
    const h = installFakeWindow();
    const { pushOverlay } = await import("@/lib/overlayHistory");
    const onPop = vi.fn();
    const close = pushOverlay(onPop);
    close();
    await flush();
    expect(h.at()).toBe(0);
    expect(onPop).not.toHaveBeenCalled();
    close(); // idempotent
    await flush();
    expect(h.at()).toBe(0);
  });

  it("two overlays: Back closes the top one, then the next", async () => {
    const h = installFakeWindow();
    const { pushOverlay } = await import("@/lib/overlayHistory");
    const a = vi.fn();
    const b = vi.fn();
    pushOverlay(a);
    pushOverlay(b);
    h.w.history.back();
    await flush();
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    h.w.history.back();
    await flush();
    expect(a).toHaveBeenCalledTimes(1);
    expect(h.at()).toBe(0);
  });
});

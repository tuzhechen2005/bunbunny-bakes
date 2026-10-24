import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A tiny history: entries with a state, an index, synchronous popstate on back()/forward(). */
function installFakeWindow() {
  const entries: unknown[] = [null];
  let index = 0;
  const listeners = new Set<(e: { state: unknown }) => void>();
  const fire = () => listeners.forEach((l) => l({ state: entries[index] }));
  const history = {
    get state() {
      return entries[index];
    },
    pushState(state: unknown) {
      entries.splice(index + 1);
      entries.push(state);
      index++;
    },
    back() {
      if (index > 0) {
        index--;
        fire();
      }
    },
    forward() {
      if (index < entries.length - 1) {
        index++;
        fire();
      }
    },
  };
  const fakeWindow = {
    history,
    addEventListener: (type: string, fn: (e: { state: unknown }) => void) => {
      if (type === "popstate") listeners.add(fn);
    },
  };
  vi.stubGlobal("window", fakeWindow);
  return { history, entries: () => entries, index: () => index };
}

describe("pushOverlay", () => {
  let h: ReturnType<typeof installFakeWindow>;
  let pushOverlay: typeof import("@/lib/overlayHistory").pushOverlay;

  beforeEach(async () => {
    vi.resetModules();
    h = installFakeWindow();
    ({ pushOverlay } = await import("@/lib/overlayHistory"));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Back pops the entry and calls onPop once", () => {
    const onPop = vi.fn();
    pushOverlay(onPop);
    expect(h.index()).toBe(1);
    h.history.back();
    expect(onPop).toHaveBeenCalledTimes(1);
    expect(h.index()).toBe(0);
  });

  it("closing by other means removes the entry without calling onPop", () => {
    const onPop = vi.fn();
    const close = pushOverlay(onPop);
    close();
    expect(onPop).not.toHaveBeenCalled();
    expect(h.index()).toBe(0);
    close(); // idempotent: no second history.back()
    expect(h.index()).toBe(0);
  });

  it("close() after Back already popped does nothing", () => {
    const onPop = vi.fn();
    const close = pushOverlay(onPop);
    h.history.back();
    h.history.pushState({ other: true }); // the page moved on
    const index = h.index();
    close();
    expect(h.index()).toBe(index);
  });

  it("close() leaves the history alone when the entry is no longer the current one", () => {
    const close = pushOverlay(() => undefined);
    h.history.pushState({ page: "/checkout" }); // navigated on while the overlay was open
    close();
    expect(h.index()).toBe(2);
  });

  it("stacked overlays pop from the top, one per Back", () => {
    const order: string[] = [];
    pushOverlay(() => order.push("a"));
    pushOverlay(() => order.push("b"));
    h.history.back();
    expect(order).toEqual(["b"]);
    h.history.back();
    expect(order).toEqual(["b", "a"]);
  });

  it("keeps the other state fields of the current entry", () => {
    h.history.pushState({ keep: 1 });
    pushOverlay(() => undefined);
    expect(h.history.state).toMatchObject({ keep: 1, bbOverlay: expect.any(Number) });
  });

  it("does nothing on the server", async () => {
    vi.unstubAllGlobals();
    vi.resetModules();
    const mod = await import("@/lib/overlayHistory");
    expect(() => mod.pushOverlay(() => undefined)()).not.toThrow();
  });
});

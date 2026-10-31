import { afterEach, expect, it, vi } from "vitest";
import { renderRun } from "@/components/run/runRenderer";
import { manifest, type RunArt } from "@/components/run/runAssets";
import { createRunGame } from "@/lib/run";

function drawingContext(scale = 1) {
  return {
    getTransform: () => ({ a: scale }),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    closePath: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
  };
}
function setup() {
  const contexts: ReturnType<typeof drawingContext>[] = [];
  const createElement = vi.fn(() => {
    const ctx = drawingContext();
    contexts.push(ctx);
    return { width: 0, height: 0, getContext: () => ctx };
  });
  vi.stubGlobal("document", { createElement });
  const art = Object.fromEntries(Object.keys(manifest.assets).map(name => [name, { width: 768, height: 768 }])) as RunArt;
  const game = createRunGame({ seed: "v1.abcdef0123456789" });
  const ctx = drawingContext();
  return { contexts, createElement, art, game, ctx };
}
const canvasContext = (ctx: ReturnType<typeof drawingContext>) => ctx as unknown as CanvasRenderingContext2D;
afterEach(() => vi.unstubAllGlobals());

it("reuses painted scenery and facade strips across moving frames", () => {
  const { contexts, createElement, art, game, ctx } = setup();
  const draw = () => renderRun(canvasContext(ctx), art, game.state(), 370, 650, false);
  draw();
  const allocated = createElement.mock.calls.length;
  const staticPaints = contexts.map(c => c.drawImage.mock.calls.length);
  expect(allocated).toBeGreaterThan(0);
  expect(contexts.reduce((n, c) => n + c.createLinearGradient.mock.calls.length, 0)).toBe(1);
  ctx.drawImage.mockClear();
  for (let tick = 1; tick <= 60; tick++) { game.step(tick); draw(); }
  expect(createElement).toHaveBeenCalledTimes(allocated);
  expect(contexts.map(c => c.drawImage.mock.calls.length)).toEqual(staticPaints);
  expect(contexts.reduce((n, c) => n + c.createLinearGradient.mock.calls.length, 0)).toBe(1);
  expect(ctx.createLinearGradient).not.toHaveBeenCalled();
  expect(ctx.drawImage).toHaveBeenCalled();
});

it("invalidates caches for size, pixel ratio, or art changes, then reuses them", () => {
  const { createElement, art, game, ctx } = setup();
  const context = canvasContext(ctx);
  let last = 0;
  for (const [width, height, scale, images] of [
    [320, 650, 1, art], [390, 650, 1, art], [390, 700, 1, art],
    [390, 700, 3, art], [390, 700, 3, { ...art }],
  ] as const) {
    ctx.getTransform = () => ({ a: scale });
    renderRun(context, images, game.state(), width, height, false);
    const allocated = createElement.mock.calls.length;
    expect(allocated).toBeGreaterThan(last);
    renderRun(context, images, game.state(), width, height, false);
    expect(createElement).toHaveBeenCalledTimes(allocated);
    last = allocated;
  }
});

it("does not multiply scenery submissions on high-DPR screens", () => {
  const { art, game } = setup();
  const counts = [1, 3].map(scale => {
    const ctx = drawingContext(scale);
    renderRun(canvasContext(ctx), art, game.state(), 370, 650, false);
    return ctx.drawImage.mock.calls.length;
  });
  expect(counts[1]).toBe(counts[0]);
  expect(counts[1]).toBeLessThan(700);
});

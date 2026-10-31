import { afterEach, expect, it, vi } from "vitest";
import { prepareRunRenderer, renderRun } from "@/components/run/runRenderer";
import { manifest, type RunArt } from "@/components/run/runAssets";
import { createRunGame } from "@/lib/run";

function drawingContext(scale = 1) {
  return {
    getTransform: () => ({ a: scale }),
    setTransform: vi.fn(),save:vi.fn(),restore:vi.fn(),clip:vi.fn(),
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
  vi.stubGlobal("Path2D",class {moveTo(){} lineTo(){} closePath(){}});
  const art = Object.fromEntries(Object.keys(manifest.assets).map(name => [name, { width: 768, height: 768 }])) as RunArt;
  const game = createRunGame({ seed: "v1.abcdef0123456789" });
  const ctx = drawingContext();
  return { contexts, createElement, art, game, ctx };
}
const canvasContext = (ctx: ReturnType<typeof drawingContext>) => ctx as unknown as CanvasRenderingContext2D;
afterEach(() => vi.unstubAllGlobals());

it("reuses painted scenery across moving frames", () => {
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
    prepareRunRenderer(context,images,width,height,scale);
    renderRun(context, images, game.state(), width, height, false);
    const allocated = createElement.mock.calls.length;
    expect(allocated).toBeGreaterThan(last);
    renderRun(context, images, game.state(), width, height, false);
    expect(createElement).toHaveBeenCalledTimes(allocated);
    last = allocated;
  }
});

it("bounds scenery submissions and caps detail at DPR 2", () => {
  const { art, game } = setup();
  const counts = [1, 2, 3].map(scale => {
    const ctx = drawingContext(scale);
    renderRun(canvasContext(ctx), art, game.state(), 370, 650, false);
    return ctx.drawImage.mock.calls.length;
  });
  expect(counts[2]).toBe(counts[1]);
  expect(counts[1]).toBeLessThan(1100);
});

import { worldHeightPixels, jumpLift, slideBodyHeight, runGeometry } from "@/lib/run/geometry";
it("draws the bunny feet/lift and crouch to the authoritative geometry on every action tick", () => {
  const {art,game,ctx}=setup();
  for(const [pose,duration] of [['jump',42],['slide',36]] as const) {
    for(let tick=0;tick<duration;tick++) {
      const state=game.state();
      state.player.pose=pose;state.player.progress=Math.floor(tick*1000/duration);
      ctx.drawImage.mockClear();
      renderRun(canvasContext(ctx),art,state,390,650,false);
      const call=ctx.drawImage.mock.calls.at(-1)!;
      const asset=manifest.assets[pose==='jump'?'bunny-jump':'bunny-slide'];
      const frame=asset.frames[pose==='jump'?Math.min(2,Math.floor(state.player.progress*3/1000)):state.player.progress<250?0:1];
      const scaleY=call[8]/frame.rect[3];
      const feet=call[6]+frame.anchor[1]*scaleY;
      expect(feet).toBeCloseTo(650*runGeometry.feet-(pose==='jump'?worldHeightPixels(jumpLift(state.player.progress),650):0),6);
      const height=(frame.anchor[1]-frame.contentBounds[1])*scaleY;
      expect(height).toBeCloseTo(worldHeightPixels(pose==='slide'?slideBodyHeight(state.player.progress):runGeometry.standingHeight,650),6);
    }
  }
});
it("maps continuous facade columns from cached mips, with no large source sheet in the hot path", () => {
  const {art,game,ctx}=setup();
  renderRun(canvasContext(ctx),art,game.state(),390,650,false);
  const calls=ctx.drawImage.mock.calls;
  expect(calls.some(c=>Object.values(art).includes(c[0]))).toBe(false);
  const strips=calls.filter(c=>c.length===9&&c[7]<=2.26);
  expect(strips.length).toBeGreaterThan(150);
  expect(calls.length).toBeLessThan(650);
});

it("preserves projected collision ground endpoints in the actual obstacle draw bands",()=>{
  const {art,game,ctx}=setup();
  const state=game.state();state.objects=[{id:1,lane:1,z:1000,kind:'cart'}];
  renderRun(canvasContext(ctx),art,state,390,650,false);
  const a=manifest.assets['bread-cart'];
  const calls=ctx.drawImage.mock.calls.filter(c=>c.length===9&&c[7]>5&&Math.abs(c[5]-(195-a.anchor[0]*worldHeightPixels(4400,650)*(24000/25000)/(a.anchor[1]-a.heightTop[1])))<1e-6);
  expect(calls.length).toBe(5);
  const front=650*(runGeometry.horizon+(runGeometry.feet-runGeometry.horizon)*24000/(24000+1000-runGeometry.obstacles.cart.front));
  const back=650*(runGeometry.horizon+(runGeometry.feet-runGeometry.horizon)*24000/(24000+1000+runGeometry.obstacles.cart.back));
  expect(calls[2][6]).toBeCloseTo(back,6);
  expect(calls[4][6]).toBeCloseTo(front,6);
});

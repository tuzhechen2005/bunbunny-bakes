import { afterEach, expect, it, vi } from 'vitest';
import { createTdRenderer } from '@/components/td/tdRenderer';
import { createTdGame, tdLevel } from '@/lib/td';

afterEach(() => vi.unstubAllGlobals());

function scene(reduced = false) {
  const drawImage = vi.fn();
  const context = () => ({
    drawImage: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), clip: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fill: vi.fn(), arc: vi.fn(), ellipse: vi.fn(), setTransform: vi.fn(),
  });
  const ctx = { ...context(), drawImage, globalAlpha: 1 };
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => context() }) });
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => 'white' }));
  const canvas = { width: 720, height: 1080, getContext: () => ctx } as unknown as HTMLCanvasElement;
  const tiers = ['cheap', 'expensive'].map(id => ({ id, radius: .1, points: 1, imageUrl: null, color: { bg: 'white', ink: 'black' } }));
  const render = createTdRenderer(canvas, 0, {}, tiers, [null, null], reduced);
  const state = createTdGame({ level: tdLevel('2026-10-26', 1), tierCount: 2 }).state();
  const draw = () => { drawImage.mockClear(); render(state); return drawImage.mock.calls.slice(1); };
  return { ctx, state, draw };
}

it('lays ten separate rounded photo tiles on a tray and removes stolen tiles without shifting survivors', () => {
  const { state, draw, ctx } = scene();
  const initial = draw();
  expect(initial).toHaveLength(10);
  for (const tile of initial) {
    const [, x, y, w, h] = tile;
    expect(x).toBeGreaterThanOrEqual(0); expect(x + w).toBeLessThanOrEqual(720);
    expect(y).toBeGreaterThanOrEqual(0); expect(y + h).toBeLessThanOrEqual(1080);
    for (const other of initial) if (other !== tile) {
      expect(x + w <= other[1] || other[1] + other[3] <= x || y + h <= other[2] || other[2] + other[4] <= y).toBe(true);
    }
  }
  state.tick = 10; state.bread = 8; state.breadTiers.splice(0, 2);
  expect(draw()).toHaveLength(10);
  state.tick = 19;
  expect(draw()[0][2]).toBeLessThan(initial[0][2]);
  state.tick = 28;
  expect(draw()).toEqual(initial.slice(2));
  expect(ctx.globalAlpha).toBe(1);
  state.tick = 40; state.bread = 1; state.breadTiers.splice(0, 7); draw();
  state.tick = 58;
  expect(draw()).toEqual(initial.slice(9));
});

it('fades theft without moving tiles in reduced motion and removes the final tile on terminal frames', () => {
  const { state, draw } = scene(true);
  const initial = draw();
  state.tick = 10; state.bread = 9; state.breadTiers.shift(); draw();
  state.tick = 19;
  expect(draw()[0].slice(1)).toEqual(initial[0].slice(1));
  state.bread = 0; state.breadTiers = []; state.over = true;
  expect(draw()).toHaveLength(0);
});

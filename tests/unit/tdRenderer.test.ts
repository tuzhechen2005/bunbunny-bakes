import { afterEach, expect, it, vi } from 'vitest';
import { createTdRenderer } from '@/components/td/tdRenderer';
import { createTdGame, tdLevel } from '@/lib/td';

afterEach(() => vi.unstubAllGlobals());

/** Any 2D context call is a no-op; drawImage calls are recorded. */
function mockContext() {
  const drawImage = vi.fn();
  const target: Record<string | symbol, unknown> = { drawImage, globalAlpha: 1 };
  const ctx = new Proxy(target, {
    get: (o, k) => k in o ? o[k] : (o[k] = vi.fn(() => ({ addColorStop: vi.fn() }))),
    set: (o, k, v) => { o[k] = v; return true; },
  });
  return { ctx, drawImage };
}

function scene() {
  const main = mockContext();
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => mockContext().ctx }) });
  const canvas = { width: 720, height: 1080, getContext: () => main.ctx, getBoundingClientRect: () => ({ width: 360, height: 540 }) } as unknown as HTMLCanvasElement;
  const tiers = ['cheap', 'expensive'].map(id => ({ id, radius: .1, points: 1, imageUrl: null, color: { bg: 'white', ink: 'black' } }));
  const state = createTdGame({ level: tdLevel('2026-10-26', 1), tierCount: 2 }).state();
  const view = createTdRenderer(canvas, state.mapData, {}, tiers, [null, null], false);
  return { view, state, drawImage: main.drawImage };
}

it('draws one photo token per remaining bread on the plate', () => {
  const { view, state, drawImage } = scene();
  view.draw(state, null, null);
  // First call paints the cached background layer; the rest are pile tokens (no towers/pests yet).
  expect(drawImage.mock.calls.length - 1).toBe(state.breadTiers.length);
  drawImage.mockClear();
  state.breadTiers.splice(0, 3);
  view.draw(state, null, null);
  expect(drawImage.mock.calls.length - 1).toBe(state.breadTiers.length);
});

it('ignores unknown events and keeps drawing with a selection and preview', () => {
  const { view, state } = scene();
  view.ingest([{ type: 'kill', tick: 1, pest: 99, bounty: 5, x: 100, y: 100 }], state);
  expect(() => view.draw(state, 0, 'oven')).not.toThrow();
});

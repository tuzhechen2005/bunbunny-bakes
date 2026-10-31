import type { RunState } from "@/lib/run";
import type { RunArt } from "./runAssets";
import { createRunGL, type RunView } from "./runGL";
import { prepareRunRenderer, renderRun } from "./runRenderer";
export type { RunView };

/** WebGL first (D157); the cached Canvas 2D renderer remains the fallback. */
export function createRunView(canvas: HTMLCanvasElement, art: RunArt): RunView & { webgl: boolean } {
  const gl = createRunGL(canvas, art);
  if (gl) return Object.assign(gl, { webgl: true });
  const ctx = canvas.getContext("2d")!;
  let w = 1, h = 1;
  return {
    webgl: false,
    resize(width, height, dpr) {
      w = width; h = height;
      const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
      if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
      ctx.setTransform(pw / w, 0, 0, ph / h, 0, 0);
      prepareRunRenderer(ctx, art, w, h, dpr);
    },
    draw(s: RunState, quiet: boolean, crashFrame: number | null) { renderRun(ctx, art, s, w, h, quiet, crashFrame); },
    dispose() {},
  };
}

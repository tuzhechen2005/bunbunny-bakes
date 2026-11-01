// WebGL renderer for 兔兔跑酷 (D157): a real perspective camera over a handful of
// textured quads per frame. Pre-rendered Blender sprites stay the art source; the GPU
// only places them. Hot path allocates nothing: one Float32Array, reused batches.
import type { RunState, RunObject } from "@/lib/run";
import { runGeometry, jumpLift, slideBodyHeight } from "@/lib/run/geometry";
import { manifest, type AssetName, type RunArt } from "./runAssets";

const LANE = 2.6, ROAD_HALF = 4.4, WALL = 7.2, CURB = 0.22;
const BUILDING_LEN = 9.6, BUILDING_H = 8;
const ROAD_TILE = 5.4, DASH_GAP = 4.5, DASH_LEN = 1.7;
const FOG_NEAR = 48, FOG_FAR = 112;
const FOG: readonly [number, number, number] = [0.965, 0.878, 0.82];
const MAX_QUADS = 1400, FLOATS = 9, QUAD_FLOATS = FLOATS * 6;
const RUN_SCALE = runGeometry.standingHeight / 1000;

type Extra = "white" | "shadow" | "puddle" | "glint";
type TexName = AssetName | Extra;
interface Tex { tex: WebGLTexture; w: number; h: number }
type Asset = (typeof manifest.assets)[AssetName];
type Frame = Asset["frames"][number];

const VS = `attribute vec3 p;attribute vec2 u;attribute vec4 c;uniform mat4 m;varying vec2 v;varying vec4 k;varying float d;
void main(){vec4 q=m*vec4(p,1.);gl_Position=q;v=u;k=c;d=q.w;}`;
const FS = `precision mediump float;uniform sampler2D t;uniform vec3 f;uniform vec2 r;varying vec2 v;varying vec4 k;varying float d;
void main(){vec4 s=texture2D(t,v)*k;s.rgb=mix(s.rgb,f*s.a,smoothstep(r.x,r.y,d));gl_FragColor=s;}`;

const pot = (n: number) => Math.min(2048, 2 ** Math.ceil(Math.log2(Math.max(1, n))));
const ease = (t: number) => t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
const hash = (i: number) => { const x = Math.sin(i * 127.1 + 31.7) * 43758.5453; return x - Math.floor(x); };

function paint(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d")!); return c;
}
/** Water reads at a glance: deep blue against warm stone, bright sky glints, wet rim. */
function puddleArt() {
  return paint(256, 256, g => {
    g.translate(128, 128);
    const rim = g.createRadialGradient(0, 0, 60, 0, 0, 128);
    rim.addColorStop(0, "rgba(70,90,110,.55)"); rim.addColorStop(1, "rgba(70,90,110,0)");
    g.fillStyle = rim; g.beginPath(); g.ellipse(0, 0, 126, 124, 0, 0, 7); g.fill();
    const water = g.createLinearGradient(0, -110, 0, 110);
    water.addColorStop(0, "#2f6f9f"); water.addColorStop(.55, "#4a95c6"); water.addColorStop(1, "#7cc0e4");
    g.fillStyle = water; g.beginPath();
    g.moveTo(-104, -20); g.bezierCurveTo(-110, -92, -20, -112, 36, -100); g.bezierCurveTo(112, -86, 118, 0, 104, 40);
    g.bezierCurveTo(92, 104, 10, 112, -44, 102); g.bezierCurveTo(-104, 90, -100, 30, -104, -20); g.fill();
    g.strokeStyle = "rgba(255,255,255,.9)"; g.lineCap = "round"; g.lineWidth = 9;
    g.beginPath(); g.moveTo(-58, -48); g.lineTo(18, -60); g.stroke();
    g.lineWidth = 6; g.beginPath(); g.moveTo(-22, 8); g.lineTo(54, -2); g.stroke();
    g.lineWidth = 4; g.globalAlpha = .7; g.beginPath(); g.moveTo(-40, 52); g.lineTo(8, 46); g.stroke();
  });
}
function radial(stops: [number, string][]) {
  return paint(128, 128, g => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const [o, c] of stops) gr.addColorStop(o, c);
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
}

/** Projection mirrored in X: the camera looks toward +Z, and world +X must land on screen right. */
function perspective(out: Float32Array, fovy: number, aspect: number, near: number, far: number) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  out.fill(0); out[0] = -f / aspect; out[5] = f; out[10] = (far + near) * nf; out[11] = -1; out[14] = 2 * far * near * nf;
}
function lookAt(out: Float32Array, ex: number, ey: number, ez: number, tx: number, ty: number, tz: number) {
  let zx = ex - tx, zy = ey - ty, zz = ez - tz; let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
  let xx = zz, xz = -zx; l = Math.hypot(xx, xz); xx /= l; xz /= l;
  const yx = zy * xz, yy = zz * xx - zx * xz, yz = -zy * xx;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = 0; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * ex + xz * ez); out[13] = -(yx * ex + yy * ey + yz * ez); out[14] = -(zx * ex + zy * ey + zz * ez); out[15] = 1;
}
function multiply(out: Float32Array, a: Float32Array, b: Float32Array) {
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    out[j * 4 + i] = a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1] + a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3];
  }
}

export interface RunView { resize(w: number, h: number, dpr: number): void; draw(s: RunState, quiet: boolean, crashFrame: number | null): void; dispose(): void }

export function createRunGL(canvas: HTMLCanvasElement, art: RunArt): RunView | null {
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true, powerPreference: "high-performance" });
  if (!gl) return null;
  const ctx: WebGLRenderingContext = gl;
  const data = new Float32Array(MAX_QUADS * QUAD_FLOATS);
  const batchTex: (Tex | null)[] = new Array(MAX_QUADS).fill(null);
  const batchStart = new Int32Array(MAX_QUADS), batchCount = new Int32Array(MAX_QUADS);
  const proj = new Float32Array(16), view = new Float32Array(16), mvp = new Float32Array(16);
  const order = new Int32Array(256), orderZ = new Float32Array(256);
  let program: WebGLProgram, buffer: WebGLBuffer, uM: WebGLUniformLocation, uF: WebGLUniformLocation, uR: WebGLUniformLocation;
  let textures = {} as Record<TexName, Tex>;
  let quads = 0, batches = 0, current: Tex | null = null;
  let width = 1, height = 1, lost = false;
  let lastBread = -1, popTick = -1000;

  function texture(source: TexImageSource, w: number, h: number, repeat = false): Tex {
    const pw = pot(w), ph = pot(h);
    const scaled = pw === w && ph === h ? source : paint(pw, ph, g => { g.imageSmoothingQuality = "high"; g.drawImage(source as CanvasImageSource, 0, 0, pw, ph); });
    const tex = ctx.createTexture()!;
    ctx.bindTexture(ctx.TEXTURE_2D, tex);
    ctx.pixelStorei(ctx.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, ctx.RGBA, ctx.UNSIGNED_BYTE, scaled);
    ctx.generateMipmap(ctx.TEXTURE_2D);
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.LINEAR_MIPMAP_LINEAR);
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx.LINEAR);
    const wrap = repeat ? ctx.REPEAT : ctx.CLAMP_TO_EDGE;
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, wrap); ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, wrap);
    const aniso = ctx.getExtension("EXT_texture_filter_anisotropic");
    if (aniso) ctx.texParameterf(ctx.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, ctx.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    return { tex, w, h };
  }
  function init() {
    const shader = (type: number, src: string) => { const s = ctx.createShader(type)!; ctx.shaderSource(s, src); ctx.compileShader(s); return s; };
    program = ctx.createProgram()!;
    ctx.attachShader(program, shader(ctx.VERTEX_SHADER, VS)); ctx.attachShader(program, shader(ctx.FRAGMENT_SHADER, FS));
    ctx.linkProgram(program); ctx.useProgram(program);
    buffer = ctx.createBuffer()!; ctx.bindBuffer(ctx.ARRAY_BUFFER, buffer);
    ctx.bufferData(ctx.ARRAY_BUFFER, data.byteLength, ctx.DYNAMIC_DRAW);
    const attr = (name: string, size: number, offset: number) => {
      const loc = ctx.getAttribLocation(program, name); ctx.enableVertexAttribArray(loc);
      ctx.vertexAttribPointer(loc, size, ctx.FLOAT, false, FLOATS * 4, offset * 4);
    };
    attr("p", 3, 0); attr("u", 2, 3); attr("c", 4, 5);
    uM = ctx.getUniformLocation(program, "m")!; uF = ctx.getUniformLocation(program, "f")!; uR = ctx.getUniformLocation(program, "r")!;
    ctx.uniform3f(uF, FOG[0], FOG[1], FOG[2]); ctx.uniform2f(uR, FOG_NEAR, FOG_FAR);
    ctx.enable(ctx.BLEND); ctx.blendFunc(ctx.ONE, ctx.ONE_MINUS_SRC_ALPHA); ctx.disable(ctx.DEPTH_TEST);
    textures = {} as Record<TexName, Tex>;
    for (const name of Object.keys(manifest.assets) as AssetName[]) {
      const img = art[name]; textures[name] = texture(img, img.naturalWidth || img.width, img.naturalHeight || img.height, name === "road-stone");
    }
    textures.white = texture(paint(4, 4, g => { g.fillStyle = "#fff"; g.fillRect(0, 0, 4, 4); }), 4, 4);
    textures.shadow = texture(radial([[0, "rgba(60,40,30,.42)"], [.6, "rgba(60,40,30,.2)"], [1, "rgba(60,40,30,0)"]]), 128, 128);
    textures.glint = texture(radial([[0, "rgba(255,250,220,1)"], [.35, "rgba(255,226,150,.65)"], [1, "rgba(255,210,120,0)"]]), 128, 128);
    textures.puddle = texture(puddleArt(), 256, 256);
  }
  init();
  const onLost = (e: Event) => { e.preventDefault(); lost = true; };
  const onRestored = () => { lost = false; init(); resize(width, height, canvas.width / width); };
  canvas.addEventListener("webglcontextlost", onLost); canvas.addEventListener("webglcontextrestored", onRestored);

  // ---- quad emission -------------------------------------------------------------
  function bind(t: Tex) {
    if (current === t && batches > 0) return;
    current = t; batchTex[batches] = t; batchStart[batches] = quads * 6; batchCount[batches] = 0; batches++;
  }
  function vert(o: number, x: number, y: number, z: number, u: number, v: number, r: number, g: number, b: number, a: number) {
    data[o] = x; data[o + 1] = y; data[o + 2] = z; data[o + 3] = u; data[o + 4] = v;
    data[o + 5] = r * a; data[o + 6] = g * a; data[o + 7] = b * a; data[o + 8] = a;
  }
  /** Four corners in order: near-left, near-right, far-right, far-left (any planar quad). */
  function quad(t: Tex, ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number,
    u0: number, v0: number, u1: number, v1: number, r = 1, g = 1, b = 1, a = 1) {
    if (quads >= MAX_QUADS || a <= 0) return;
    bind(t);
    const o = quads * QUAD_FLOATS;
    vert(o, ax, ay, az, u0, v1, r, g, b, a); vert(o + 9, bx, by, bz, u1, v1, r, g, b, a); vert(o + 18, cx, cy, cz, u1, v0, r, g, b, a);
    vert(o + 27, ax, ay, az, u0, v1, r, g, b, a); vert(o + 36, cx, cy, cz, u1, v0, r, g, b, a); vert(o + 45, dx, dy, dz, u0, v0, r, g, b, a);
    quads++; batchCount[batches - 1] += 6;
  }
  function ground(t: Tex, x0: number, x1: number, z0: number, z1: number, u0 = 0, v0 = 0, u1 = 1, v1 = 1, r = 1, g = 1, b = 1, a = 1, y = 0) {
    quad(t, x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1, u0, v0, u1, v1, r, g, b, a);
  }
  /** Upright billboard facing the camera (constant Z), anchored at its ground contact. */
  function billboard(name: TexName, f: Frame | null, x: number, y: number, z: number, sx: number, sy = sx, a = 1, r = 1, g = 1, b = 1) {
    const t = textures[name];
    const rect = f ? f.rect : [0, 0, t.w, t.h], anchor = f ? f.anchor : [t.w / 2, t.h];
    const left = x - anchor[0] * sx, right = left + rect[2] * sx, top = y + anchor[1] * sy, bottom = top - rect[3] * sy;
    quad(t, left, bottom, z, right, bottom, z, right, top, z, left, top, z,
      rect[0] / t.w, rect[1] / t.h, (rect[0] + rect[2]) / t.w, (rect[1] + rect[3]) / t.h, r, g, b, a);
  }
  const shadow = (x: number, z: number, w: number, d: number, a = 1) => ground(textures.shadow, x - w / 2, x + w / 2, z - d / 2, z + d / 2, 0, 0, 1, 1, 1, 1, 1, a, 0.02);

  // ---- per-kind sprite sizing ------------------------------------------------------
  const asset = (n: AssetName) => manifest.assets[n] as Asset & { heightTop?: number[]; geometry?: { height: number } };
  function obstacleScale(n: AssetName, kind: keyof typeof runGeometry.obstacles) {
    const a = asset(n), f = a.frames[0];
    const byHeight = runGeometry.obstacles[kind].height / 1000 / (a.anchor[1] - (a.heightTop?.[1] ?? f.contentBounds[1]));
    const byWidth = LANE * .94 / f.contentBounds[2];
    return kind === "cart" ? [Math.min(byHeight, byWidth), Math.min(byHeight, byWidth)] : kind === "awning" ? [byWidth, byHeight] : [byHeight, byHeight];
  }
  const SIZES = {
    cart: obstacleScale("bread-cart", "cart"), flour: obstacleScale("flour-sacks", "flour"), awning: obstacleScale("shop-awning", "awning"),
    bread: .82 / manifest.assets["loaf-spin"].frames[0].contentBounds[3],
    bag: 1.5 / manifest.assets["paper-bag"].frames[0].contentBounds[3],
    coffee: 1.5 / manifest.assets["coffee-cup"].frames[0].contentBounds[3],
  };
  const runFrame = manifest.assets["bunny-run"].frames[0];
  const bunnyScale = RUN_SCALE / (runFrame.anchor[1] - runFrame.contentBounds[1]);

  function resize(w: number, h: number, dpr: number) {
    width = w; height = h;
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    ctx.viewport(0, 0, pw, ph);
  }

  function emitObject(o: RunObject, z: number, s: RunState, bunnyX: number, quiet: boolean) {
    let x = (o.lane - 1) * LANE;
    const bob = quiet ? 0 : Math.sin((s.tick + o.id * 13) * .12) * .12;
    switch (o.kind) {
      case "bread": {
        if (s.powerUps.magnetTicks > 0 && z < 14) x += (bunnyX - x) * Math.min(1, (14 - z) / 10);
        const a = manifest.assets["loaf-spin"], f = a.frames[quiet ? 0 : Math.floor((s.tick + o.id * 3) / 5) % a.frames.length];
        shadow(x, z, .9, .5, .7);
        billboard("loaf-spin", f, x, (o.y ?? 0) / 1000 + .55 + bob, z, SIZES.bread * (o.value === 5 ? 1.6 : 1));
        return;
      }
      case "paper-bag": case "coffee": {
        const name = o.kind === "coffee" ? "coffee-cup" : "paper-bag";
        const pulse = quiet ? .5 : .5 + .5 * Math.sin(s.tick * .15);
        billboard("glint", null, x, -0.2 + bob, z + .05, 2.6 / 128, 2.6 / 128, .55 + .35 * pulse);
        shadow(x, z, 1, .55, .7);
        billboard(name, manifest.assets[name].frames[0], x, .45 + bob, z, o.kind === "coffee" ? SIZES.coffee : SIZES.bag);
        return;
      }
      case "cart": shadow(x, z, LANE * .95, 2.6, .9); billboard("bread-cart", manifest.assets["bread-cart"].frames[0], x, 0, z, SIZES.cart[0], SIZES.cart[1]); return;
      case "flour": shadow(x, z, LANE * .8, 1.4, .8); billboard("flour-sacks", manifest.assets["flour-sacks"].frames[0], x, 0, z, SIZES.flour[0], SIZES.flour[1]); return;
      case "awning": shadow(x, z, LANE * .95, 1.2, .5); billboard("shop-awning", manifest.assets["shop-awning"].frames[0], x, 0, z, SIZES.awning[0], SIZES.awning[1]); return;
      case "van": case "truck": shadow(x, z, LANE * .95, 2.6, .9); billboard("bread-cart", manifest.assets["bread-cart"].frames[0], x, 0, z, SIZES.cart[0], SIZES.cart[1]); return;
      case "puddle": case "ramp": return; // ground pass / not drawn in the sprite fallback
    }
  }

  function draw(s: RunState, quiet: boolean, crashFrame: number | null) {
    if (lost) return;
    quads = 0; batches = 0; current = null;
    const dist = s.distance / 1000;
    const change = s.player.laneChange;
    const lanePos = change ? change.from + (change.to - change.from) * ease(change.progress / 1000) : s.player.lane;
    const bunnyX = (lanePos - 1) * LANE;
    const speedT = Math.max(0, Math.min(1, (s.speed - 320) / 430));
    const coffee = s.powerUps.coffeeTicks > 0;

    // Camera: low and behind, drifting toward the bunny's lane; FOV opens with speed.
    const shake = crashFrame !== null && crashFrame < 2 && !quiet ? Math.sin(s.tick * 2.3) * .25 : 0;
    const camX = bunnyX * .55 + shake;
    const aspect = width / height;
    perspective(proj, (52 + speedT * 6 + (coffee ? 4 : 0)) * Math.PI / 180, aspect, .5, 140);
    lookAt(view, camX, 6.4, -12.5, bunnyX * .35, 1.2, 20);
    multiply(mvp, proj, view);

    // ---- ground pass -------------------------------------------------------------
    const road = textures["road-stone"];
    const first = Math.floor((dist - 14) / ROAD_TILE);
    for (let i = first; i < first + Math.ceil(110 / ROAD_TILE) + 1; i++) {
      const z0 = i * ROAD_TILE - dist;
      ground(road, -ROAD_HALF, ROAD_HALF, z0, z0 + ROAD_TILE, 0, 0, 1, 1);
    }
    const white = textures.white;
    for (const side of [-1, 1]) {
      const x0 = side * ROAD_HALF, x1 = side * WALL;
      ground(white, Math.min(x0, x1), Math.max(x0, x1), -14, 100, 0, 0, 1, 1, .93, .86, .76, 1);
      ground(white, side < 0 ? -ROAD_HALF - CURB : ROAD_HALF, side < 0 ? -ROAD_HALF : ROAD_HALF + CURB, -14, 100, 0, 0, 1, 1, .8, .7, .6, 1, .01);
    }
    const dashA = coffee ? .95 : .7;
    const dFirst = Math.floor((dist - 14) / DASH_GAP);
    for (let i = dFirst; i < dFirst + Math.ceil(105 / DASH_GAP); i++) {
      const z0 = i * DASH_GAP - dist, len = coffee ? DASH_LEN * 2 : DASH_LEN;
      for (const lx of [-LANE / 2, LANE / 2]) ground(white, lx - .06, lx + .06, z0, z0 + len, 0, 0, 1, 1, 1, .97, .9, dashA, .015);
    }
    // Puddles are drawn flat in the ground pass so nothing can stand "behind" them.
    for (let i = 0; i < s.objects.length; i++) {
      const o = s.objects[i]; if (o.kind !== "puddle") continue;
      const z = o.z / 1000, x = (o.lane - 1) * LANE, g = runGeometry.obstacles.puddle;
      ground(textures.puddle, x - LANE * .52, x + LANE * .52, z - g.front / 1000 - 1.1, z + g.back / 1000 + 1.1, 0, 0, 1, 1, 1, 1, 1, 1, .02);
      if (!quiet) {
        const tw = .5 + .5 * Math.sin(s.tick * .2 + o.id);
        billboard("glint", null, x - .5 + tw, -.3, z - .4, 1.4 / 128, .7 / 128, .45 + .5 * tw);
      }
    }
    const lift = s.player.pose === "jump" && crashFrame === null ? jumpLift(s.player.progress) / 1000 : 0;
    shadow(bunnyX, 0, 1.7 - lift * .18, .9 - lift * .1, 1 - lift * .12);

    // ---- facades (far to near so nearer walls overlap) ----------------------------
    const bFirst = Math.floor((dist - 16) / BUILDING_LEN);
    for (let i = bFirst + Math.ceil(112 / BUILDING_LEN); i >= bFirst; i--) {
      const z0 = i * BUILDING_LEN - dist, z1 = z0 + BUILDING_LEN;
      for (const side of [-1, 1]) {
        const name: AssetName = side < 0 ? "shops-left" : "shops-right";
        const a = manifest.assets[name], t = textures[name];
        const f = a.frames[Math.floor(hash(i * 2 + (side > 0 ? 1 : 0)) * a.frames.length) % a.frames.length];
        const u0 = f.rect[0] / t.w, u1 = (f.rect[0] + f.rect[2]) / t.w, v0 = f.rect[1] / t.h, v1 = (f.rect[1] + f.rect[3]) / t.h;
        const x = side * WALL, shade = side < 0 ? 1 : .94;
        if (side < 0) quad(t, x, 0, z0, x, 0, z1, x, BUILDING_H, z1, x, BUILDING_H, z0, u0, v0, u1, v1, shade, shade, shade);
        else quad(t, x, 0, z1, x, 0, z0, x, BUILDING_H, z0, x, BUILDING_H, z1, u0, v0, u1, v1, shade, shade, shade);
      }
    }

    // ---- sprites, painter's order ---------------------------------------------------
    let n = 0;
    for (let i = 0; i < s.objects.length && n < order.length - 1; i++) {
      if (s.objects[i].kind === "puddle") continue;
      order[n] = i; orderZ[n] = s.objects[i].z; n++;
    }
    order[n] = -1; orderZ[n] = 0; n++; // the bunny
    for (let i = 1; i < n; i++) {
      const oi = order[i], oz = orderZ[i]; let j = i - 1;
      while (j >= 0 && orderZ[j] < oz) { order[j + 1] = order[j]; orderZ[j + 1] = orderZ[j]; j--; }
      order[j + 1] = oi; orderZ[j + 1] = oz;
    }
    for (let k = 0; k < n; k++) {
      const idx = order[k];
      if (idx >= 0) { const o = s.objects[idx]; emitObject(o, o.z / 1000, s, bunnyX, quiet); continue; }
      emitBunny(s, bunnyX, lift, quiet, crashFrame);
    }
    // Pickup sparkle: rises and fades over 18 ticks after each new loaf.
    if (lastBread >= 0 && s.bread > lastBread) popTick = s.tick;
    lastBread = s.bread;
    const age = s.tick - popTick;
    if (!quiet && age >= 0 && age < 18) billboard("glint", null, bunnyX, 2.2 + age * .08, -.1, 2.4 / 128, 2.4 / 128, 1 - age / 18);

    // ---- submit -------------------------------------------------------------------
    ctx.clearColor(0, 0, 0, 0); ctx.clear(ctx.COLOR_BUFFER_BIT);
    ctx.uniformMatrix4fv(uM, false, mvp);
    ctx.bufferSubData(ctx.ARRAY_BUFFER, 0, data.subarray(0, quads * QUAD_FLOATS));
    for (let b = 0; b < batches; b++) {
      ctx.bindTexture(ctx.TEXTURE_2D, batchTex[b]!.tex);
      ctx.drawArrays(ctx.TRIANGLES, batchStart[b], batchCount[b]);
    }
  }

  function emitBunny(s: RunState, x: number, lift: number, quiet: boolean, crashFrame: number | null) {
    let name: AssetName = "bunny-run", frame = quiet ? 0 : Math.floor(s.tick * 15 / 60) % 8;
    let sx = bunnyScale, sy = bunnyScale;
    if (crashFrame !== null) {
      name = "bunny-crash"; frame = crashFrame;
      sx = sy = bunnyScale * manifest.assets["bunny-run"].pixelsPerMetre / manifest.assets["bunny-crash"].pixelsPerMetre;
    } else if (s.player.pose === "jump") {
      name = "bunny-jump"; frame = Math.min(2, Math.floor(s.player.progress * 3 / 1000));
    } else if (s.player.pose === "slide") {
      name = "bunny-slide"; frame = s.player.progress < 200 ? 0 : 1;
      const squash = slideBodyHeight(s.player.progress) / runGeometry.standingHeight;
      sy = bunnyScale * Math.max(.8, squash + .45);
    } else if (s.player.laneChange) {
      name = "bunny-lean"; frame = s.player.laneChange.to < s.player.laneChange.from ? 0 : 1;
    } else if (!quiet) {
      // Running bounce keeps the clay figure alive between frames.
      const b = Math.abs(Math.sin(s.tick * Math.PI * 15 / 120));
      sy = bunnyScale * (1 + b * .03); sx = bunnyScale * (1 - b * .015);
    }
    billboard(name, manifest.assets[name].frames[frame], x, lift, 0, sx, sy);
  }

  return {
    resize, draw,
    dispose() {
      // Never force-lose the context: a remount (StrictMode, art reload) reuses this canvas.
      canvas.removeEventListener("webglcontextlost", onLost); canvas.removeEventListener("webglcontextrestored", onRestored);
    },
  };
}

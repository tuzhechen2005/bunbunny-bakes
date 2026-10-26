// Canvas drawing of the board: pieces (pre-rendered sprites), aim guide, danger line and effects.
// Pure drawing, no React. Colours come in as `Theme` (read from the CSS tokens by the caller).
import { photoUrl } from "@/lib/photo";
import type { Body, GameEvent, TierView } from "./types";

export interface Theme {
  wash: string;
  paper: string;
  ink: string;
  line: string;
  red: string;
  /** CSS font-family list of the numeral font (floating points). */
  numFont: string;
}

const images = new Map<string, HTMLImageElement>();

/** Loads (once) the picture of a tier; `onLoad` runs when it is ready to draw. */
export function loadTierImage(url: string | null, onLoad: () => void): HTMLImageElement | null {
  if (!url) return null;
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.decoding = "async";
    img.src = photoUrl(url, 256);
    images.set(url, img);
  }
  if (img.complete && img.naturalWidth > 0) return img;
  img.addEventListener("load", onLoad, { once: true });
  return null;
}

/** One piece: tier colour disc, the bread picture clipped inside, a soft gloss and a thin border. */
export function drawTierDisc(
  ctx: CanvasRenderingContext2D,
  tier: TierView,
  cx: number,
  cy: number,
  r: number,
  img: HTMLImageElement | null,
) {
  const border = Math.max(1.25, r * 0.045);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = tier.color.bg;
  ctx.fill();
  if (img && img.naturalWidth > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - border * 0.5, 0, Math.PI * 2);
    ctx.clip();
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    const d = (r - border) * 2;
    ctx.drawImage(img, sx, sy, side, side, cx - d / 2, cy - d / 2, d, d);
    ctx.restore();
  }
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r);
  g.addColorStop(0, "rgba(255,255,255,0.34)");
  g.addColorStop(0.45, "rgba(255,255,255,0)");
  g.addColorStop(1, "rgba(0,0,0,0.08)");
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = border;
  ctx.strokeStyle = tier.color.ink;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.arc(cx, cy, r - border / 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
}
interface Ring {
  x: number;
  y: number;
  from: number;
  to: number;
  t: number;
  max: number;
  color: string;
  width: number;
}
interface Floater {
  x: number;
  y: number;
  text: string;
  t: number;
  big: boolean;
}
interface Pop {
  x: number;
  y: number;
  tier: number;
  t: number;
}

const POP_S = 0.34;
const easeOutBack = (t: number) => {
  const c1 = 2.1;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export interface Aim {
  x: number;
  tier: number;
  /** 0..1 cool-down progress (the piece fades in as it fills). */
  cooled: number;
  visible: boolean;
  /** A finger is down: the guide is drawn strong. */
  holding?: boolean;
}

export class BoardRenderer {
  private w = 0;
  private h = 0;
  private dpr = 1;
  private sprites: (HTMLCanvasElement | null)[] = [];
  private imgs: (HTMLImageElement | null)[] = [];
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private floaters: Floater[] = [];
  private pops: Pop[] = [];
  private shake = 0;
  reduced = false;
  /** Set when an image arrives so the sprites are rebuilt on the next frame. */
  dirty = true;
  /** Called when a picture arrived: the owner draws a frame even if its loop is asleep. */
  onImage: (() => void) | null = null;

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly tiers: TierView[],
    private readonly theme: Theme,
    private readonly dangerY: number,
    private readonly height: number,
  ) {
    this.tiers.forEach((t, i) => {
      this.imgs[i] = loadTierImage(t.imageUrl, () => {
        this.imgs[i] = loadTierImage(t.imageUrl, () => {});
        this.dirty = true;
        this.onImage?.();
      });
    });
  }

  /** `w` is the CSS width of the board; the height follows from the aspect ratio. */
  resize(w: number, dpr: number) {
    this.w = w;
    this.h = w * this.height;
    this.dpr = dpr;
    this.dirty = true;
  }

  private buildSprites() {
    this.dirty = false;
    this.sprites = this.tiers.map((t, i) => {
      const r = t.radius * this.w;
      const size = Math.ceil(r * 2 * this.dpr) + 4;
      const c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      const g = c.getContext("2d");
      if (!g) return null;
      g.scale(this.dpr, this.dpr);
      drawTierDisc(g, t, size / this.dpr / 2, size / this.dpr / 2, r, this.imgs[i]);
      return c;
    });
  }

  private sprite(ctx: CanvasRenderingContext2D, tier: number, x: number, y: number, scale: number, alpha = 1) {
    const s = this.sprites[tier];
    if (!s) return;
    const d = (s.width / this.dpr) * scale;
    ctx.globalAlpha = alpha;
    ctx.drawImage(s, x - d / 2, y - d / 2, d, d);
    ctx.globalAlpha = 1;
  }

  /** Reacts to engine events with particles, rings, floating points and a pop on the new piece. */
  onEvent(ev: GameEvent) {
    if (this.reduced) return;
    if (ev.type === "merge") {
      const t = this.tiers[ev.tier];
      const x = ev.x * this.w;
      const y = ev.y * this.w;
      const r = t.radius * this.w;
      this.pops.push({ x: ev.x, y: ev.y, tier: ev.tier, t: 0 });
      const n = ev.big ? 46 : 10 + Math.min(10, ev.tier * 2);
      for (let i = 0; i < n && this.particles.length < 160; i++) {
        const a = (i / n) * Math.PI * 2 + (i % 3) * 0.37;
        const sp = (ev.big ? 150 : 70) + ((i * 53) % 90);
        this.particles.push({
          x,
          y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 40,
          life: 0,
          max: ev.big ? 0.9 : 0.5,
          size: ev.big ? 3 + (i % 4) : 2 + (i % 3),
          color: ev.big && i % 2 ? this.theme.paper : t.color.bg,
        });
      }
      this.rings.push({ x, y, from: r * 0.7, to: r * (ev.big ? 2.4 : 1.5), t: 0, max: ev.big ? 0.6 : 0.35, color: t.color.bg, width: ev.big ? 6 : 3 });
      if (ev.big) {
        this.rings.push({ x, y, from: r * 0.4, to: r * 3.2, t: -0.08, max: 0.8, color: this.theme.ink, width: 2 });
        this.shake = 1;
      }
      // Several merges in one cascade: stack the numbers instead of printing them on top of each other.
      const stacked = this.floaters.filter((f) => f.t < 0.45).length;
      this.floaters.push({ x: x + (stacked === 0 ? 0 : stacked % 2 ? 14 : -14), y: y - r - stacked * 24, text: `+${ev.points}`, t: 0, big: ev.big });
    }
  }

  private step(dt: number) {
    for (const p of this.particles) {
      p.life += dt;
      p.vy += 420 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.life < p.max);
    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter((r) => r.t < r.max);
    for (const f of this.floaters) f.t += dt;
    this.floaters = this.floaters.filter((f) => f.t < 0.9);
    for (const p of this.pops) p.t += dt;
    this.pops = this.pops.filter((p) => p.t < POP_S);
    this.shake = Math.max(0, this.shake - dt / 0.38);
  }

  /** True while an effect is still moving (the loop keeps drawing). */
  get animating() {
    return this.particles.length + this.rings.length + this.floaters.length + this.pops.length > 0 || this.shake > 0;
  }

  draw(bodies: Body[], aim: Aim | null, dt: number, now: number) {
    const { ctx, w, h, theme } = this;
    if (w === 0) return;
    if (this.dirty) this.buildSprites();
    this.step(dt);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    if (this.shake > 0) {
      const m = this.shake * this.shake * 7;
      ctx.translate(Math.sin(now * 0.07) * m, Math.cos(now * 0.09) * m);
    }
    ctx.fillStyle = theme.wash;
    ctx.fillRect(-10, -10, w + 20, h + 20);

    // Danger line.
    const dy = this.dangerY * w;
    ctx.save();
    ctx.setLineDash([7, 7]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = theme.red;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(0, dy);
    ctx.lineTo(w, dy);
    ctx.stroke();
    ctx.restore();

    // Aim guide: where the piece would land.
    if (aim?.visible) {
      const pr = this.tiers[aim.tier].radius;
      const ax = Math.min(1 - pr, Math.max(pr, aim.x));
      let land = this.height - pr;
      for (const b of bodies) {
        const dx = Math.abs(b.x - ax);
        const rr = b.r + pr;
        if (dx < rr) land = Math.min(land, b.y - Math.sqrt(rr * rr - dx * dx));
      }
      ctx.save();
      ctx.setLineDash([3, 8]);
      ctx.lineCap = "round";
      ctx.lineWidth = 2;
      ctx.strokeStyle = theme.ink;
      ctx.globalAlpha = aim.holding ? 0.55 : 0.18 * aim.cooled;
      ctx.beginPath();
      ctx.moveTo(ax * w, (pr + 0.012 + pr) * w);
      ctx.lineTo(ax * w, land * w);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = aim.holding ? 0.4 : 0.14 * aim.cooled;
      ctx.beginPath();
      ctx.arc(ax * w, land * w, pr * w, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Pieces.
    for (const b of bodies) {
      let scale = 1;
      if (this.pops.length > 0 && !this.reduced) {
        for (const p of this.pops) {
          if (p.tier === b.tier && Math.abs(p.x - b.x) < b.r && Math.abs(p.y - b.y) < b.r) {
            scale = 0.62 + 0.38 * easeOutBack(Math.min(1, p.t / POP_S));
            break;
          }
        }
      }
      this.sprite(ctx, b.tier, b.x * w, b.y * w, scale);
    }

    // Piece in hand.
    if (aim?.visible) {
      const pr = this.tiers[aim.tier].radius;
      const ax = Math.min(1 - pr, Math.max(pr, aim.x));
      const c = aim.cooled;
      this.sprite(ctx, aim.tier, ax * w, (pr + 0.012) * w, 0.78 + 0.22 * c, 0.35 + 0.65 * c);
    }

    // Effects.
    for (const r of this.rings) {
      if (r.t < 0) continue;
      const k = r.t / r.max;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.from + (r.to - r.from) * (1 - Math.pow(1 - k, 3)), 0, Math.PI * 2);
      ctx.lineWidth = r.width * (1 - k);
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = 1 - k;
      ctx.stroke();
    }
    for (const p of this.particles) {
      ctx.globalAlpha = 1 - p.life / p.max;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 - 0.5 * (p.life / p.max)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const f of this.floaters) {
      const k = f.t / 0.9;
      ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      ctx.font = `700 ${f.big ? 26 : 17}px ${theme.numFont}`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = theme.paper;
      ctx.strokeText(f.text, f.x, f.y - k * 34);
      ctx.fillStyle = theme.ink;
      ctx.fillText(f.text, f.x, f.y - k * 34);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

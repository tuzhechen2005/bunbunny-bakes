import { FIELD_WIDTH as W, FIELD_HEIGHT as H, SUBUNITS, TD_SLOT_RADIUS, pathPosition, type TdClutter, type TdMap, type TdPoint, towerStats, type TdEvent, type TdState, type TowerKind, type PestKind } from '@/lib/td';
import type { TierView } from '@/components/game/types';
import type { TdArt, TdSprite } from './tdAssets';

// Canvas 2D in field units (FIELD_WIDTH×FIELD_HEIGHT). Static map + slots are cached; the frame loop
// reuses a fixed effect pool and never allocates. Game art colours live here, like SVG art.
const towerNames: Record<TowerKind, string> = { rollingPin: 'tower-pin', flourSifter: 'tower-sifter', whisk: 'tower-whisk', oven: 'tower-oven', freezer: 'tower-freezer', pipingBag: 'tower-piping', caramelTorch: 'tower-torch' };
const pestNames: Record<PestKind, string> = { ant: 'pest-ant', mouse: 'pest-mouse', sparrow: 'pest-sparrow', beetle: 'pest-beetle' };
const shotNames: Record<TowerKind, string> = { rollingPin: 'proj-pin', flourSifter: '', whisk: 'proj-whisk', oven: 'proj-oven', freezer: '', pipingBag: '', caramelTorch: '' };
const TOWER_W = 205, PEST_W = 150, BOSS_SCALE = 1.6, PHOTO = 32;
const FX = 64, TINY_SCALE = .6, CL = 160;
type FxKind = 0 | 1 | 2 | 3 | 4 | 5 | 6; // none, puff, coin, ring, dust, clutter strike, boss spit
const GOLD = '#f2c14e', INK = '#3b2a1f', CREAM = '#fff8ec';

export async function breadImages(tiers: TierView[]): Promise<(HTMLImageElement | null)[]> {
  return Promise.all(tiers.map(async t => {
    if (!t.imageUrl) return null;
    try { const img = new Image(); img.crossOrigin = 'anonymous'; img.src = t.imageUrl; await img.decode(); return img; } catch { return null; }
  }));
}

export interface TdView { draw(s: TdState, selected: number | null, preview: TowerKind | null): void; ingest(events: TdEvent[], s: TdState): void; resize(): void }

export interface TdDeco { slot?: HTMLImageElement | null; plate?: HTMLImageElement | null }
export async function loadTdDeco(): Promise<TdDeco> {
  const one = async (src: string) => { try { const i = new Image(); i.src = src; await i.decode(); return i; } catch { return null; } };
  const [slot, plate] = await Promise.all([one('/brand/art/game/td-slot.webp'), one('/brand/art/game/td-plate.webp')]);
  return { slot, plate };
}


type ClutterKind = TdClutter['kind'];
const clutterDebris: Record<ClutterKind, string> = { flourSack: '#efe0bf', eggCrate: '#c48d52', milkCan: '#cfd8dc' };
/** Flour sack, egg crate and milk can in the same soft clay look as the rest of the board; drawn once. */
function clutterArt(kind: ClutterKind): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = CL;
  const b = c.getContext('2d')!; b.translate(CL / 2, CL / 2 + 4); b.lineJoin = 'round'; b.lineCap = 'round';
  const edge = '#6b4a2e', fillV = (y0: number, y1: number, a: string, z: string) => { const g = b.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, a); g.addColorStop(1, z); return g; };
  const fillH = (x0: number, x1: number, stops: string[]) => { const g = b.createLinearGradient(x0, 0, x1, 0); stops.forEach((v, i) => g.addColorStop(i / (stops.length - 1), v)); return g; };
  b.fillStyle = 'rgba(60,30,10,.3)'; b.beginPath(); b.ellipse(0, 50, 50, 13, 0, 0, 7); b.fill();
  b.strokeStyle = edge; b.lineWidth = 4;
  if (kind === 'flourSack') {
    b.fillStyle = fillV(-40, 50, '#fcf3df', '#e3cfa4');
    b.beginPath(); b.moveTo(-38, 46); b.bezierCurveTo(-50, 12, -42, -20, -22, -34); b.lineTo(22, -34); b.bezierCurveTo(42, -20, 50, 12, 38, 46); b.quadraticCurveTo(0, 56, -38, 46); b.closePath(); b.fill(); b.stroke();
    b.fillStyle = '#f1e2c1'; b.beginPath(); b.moveTo(-22, -34); b.lineTo(-17, -52); b.lineTo(-7, -42); b.lineTo(0, -56); b.lineTo(8, -42); b.lineTo(18, -52); b.lineTo(22, -34); b.closePath(); b.fill(); b.stroke();
    b.strokeStyle = '#b5793a'; b.lineWidth = 7; b.beginPath(); b.moveTo(-24, -34); b.lineTo(24, -34); b.stroke();
    b.fillStyle = '#e4b95c'; b.strokeStyle = 'rgba(107,74,46,.55)'; b.lineWidth = 3; b.beginPath(); b.arc(0, 10, 15, 0, 7); b.fill(); b.stroke();
    b.fillStyle = 'rgba(255,255,255,.55)'; b.beginPath(); b.ellipse(-17, -4, 6, 16, .25, 0, 7); b.fill();
  } else if (kind === 'eggCrate') {
    const egg = (x: number, tint: string) => { b.fillStyle = fillV(-40, 4, '#fffaf0', tint); b.strokeStyle = edge; b.lineWidth = 3.5; b.beginPath(); b.ellipse(x, -18, 17, 22, 0, 0, 7); b.fill(); b.stroke(); };
    egg(-28, '#f0e2c6'); egg(28, '#ecd7b3'); egg(0, '#e8c99a');
    b.fillStyle = fillV(-6, 48, '#e6b982', '#c28a50'); b.strokeStyle = edge; b.lineWidth = 4;
    b.beginPath(); b.roundRect(-52, -6, 104, 54, 8); b.fill(); b.stroke();
    b.strokeStyle = 'rgba(107,74,46,.5)'; b.lineWidth = 3; b.beginPath(); b.moveTo(-50, 12); b.lineTo(50, 12); b.moveTo(-50, 30); b.lineTo(50, 30); b.stroke();
    b.fillStyle = 'rgba(255,255,255,.35)'; b.fillRect(-48, -3, 96, 4);
  } else {
    b.strokeStyle = '#8c9aa1'; b.lineWidth = 6; b.beginPath(); b.arc(-31, 8, 14, Math.PI * .5, Math.PI * 1.5); b.moveTo(31, -8); b.arc(31, 8, 14, -Math.PI * .5, Math.PI * .5); b.stroke();
    b.strokeStyle = edge; b.lineWidth = 4; b.fillStyle = fillH(-32, 32, ['#aab6bc', '#f4f7f8', '#c9d3d8', '#9eacb3']);
    b.beginPath(); b.moveTo(-32, 46); b.lineTo(-32, -22); b.quadraticCurveTo(-32, -40, -17, -44); b.lineTo(17, -44); b.quadraticCurveTo(32, -40, 32, -22); b.lineTo(32, 46); b.quadraticCurveTo(0, 56, -32, 46); b.closePath(); b.fill(); b.stroke();
    b.fillStyle = '#e18c7e'; b.fillRect(-32, 4, 64, 18); b.strokeStyle = 'rgba(107,74,46,.5)'; b.lineWidth = 3; b.strokeRect(-32, 4, 64, 18);
    b.fillStyle = fillH(-20, 20, ['#aab6bc', '#eef2f3', '#aab6bc']); b.strokeStyle = edge; b.lineWidth = 4; b.beginPath(); b.roundRect(-20, -58, 40, 16, 6); b.fill(); b.stroke();
    b.beginPath(); b.arc(0, -61, 6, 0, 7); b.fill(); b.stroke();
  }
  return c;
}

export function createTdRenderer(canvas: HTMLCanvasElement, map: TdMap, art: TdArt, tiers: TierView[], photos: (HTMLImageElement | null)[], reduced: boolean, deco: TdDeco = {}): TdView {
  const ctx = canvas.getContext('2d')!;
  const last = map.path[map.path.length - 1];
  const inside = (v: number, max: number) => Math.max(110, Math.min(max - 110, v));
  // The path exits the board; the plate sits just inside along the last segment.
  const prev = map.path[map.path.length - 2] ?? last, len = Math.hypot(last.x - prev.x, last.y - prev.y) || 1;
  const end = { x: inside(last.x - (last.x - prev.x) / len * 40, W), y: inside(last.y - (last.y - prev.y) / len * 40, H) };
  const layer = document.createElement('canvas'); layer.width = W; layer.height = H;
  const bg = layer.getContext('2d')!;
  // Maps are data now (one per level): a warm wooden counter, then the dough road and its features.
  const wood = bg.createLinearGradient(0, 0, 0, H); wood.addColorStop(0, '#e9c79c'); wood.addColorStop(1, '#d8a873');
  bg.fillStyle = wood; bg.fillRect(0, 0, W, H);
  bg.strokeStyle = 'rgba(110,62,26,.16)'; bg.lineWidth = 3;
  for (let y = 90; y < H; y += 90) { bg.beginPath(); bg.moveTo(0, y); bg.lineTo(W, y); bg.stroke(); }
  bg.fillStyle = 'rgba(255,240,214,.18)'; for (let y = 92; y < H; y += 90) bg.fillRect(0, y, W, 3);
  const line = (pts: readonly TdPoint[]) => { bg.beginPath(); bg.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) bg.lineTo(pts[i].x, pts[i].y); };
  const road = (pts: readonly TdPoint[]) => {
    if (pts.length < 2) return;
    bg.lineJoin = 'round'; bg.lineCap = 'round';
    bg.strokeStyle = 'rgba(80,45,20,.28)'; bg.lineWidth = 92; bg.save(); bg.translate(0, 8); line(pts); bg.stroke(); bg.restore();
    bg.strokeStyle = '#a8764a'; bg.lineWidth = 88; line(pts); bg.stroke();
    bg.strokeStyle = '#f3e3c8'; bg.lineWidth = 74; line(pts); bg.stroke();
    bg.strokeStyle = 'rgba(255,255,255,.45)'; bg.lineWidth = 2; bg.setLineDash([14, 18]); line(pts); bg.stroke(); bg.setLineDash([]);
  };
  const features = map.features ?? [];
  road(map.path);
  for (const f of features) if (f.type === 'fork') for (const b of f.branches ?? f.geometries ?? []) road(b);
  for (const f of features) {
    const g = f.geometry;
    if (!g || g.length < 1) continue;
    if (f.type === 'strip') {
      // Conveyor: a grey rubber belt between steel rails; the arrows that run along it are drawn per frame.
      bg.lineCap = 'butt'; bg.lineJoin = 'round';
      bg.strokeStyle = '#8a8f96'; bg.lineWidth = 70; line(g); bg.stroke();
      bg.strokeStyle = '#4c4f55'; bg.lineWidth = 58; line(g); bg.stroke();
    } else if (f.type === 'jam') {
      bg.strokeStyle = 'rgba(176,58,82,.55)'; bg.lineWidth = 66; bg.lineCap = 'round'; line(g); bg.stroke();
      bg.fillStyle = 'rgba(255,220,230,.5)';
      for (const p of g) { bg.beginPath(); bg.ellipse(p.x - 10, p.y - 8, 10, 6, -.4, 0, 7); bg.fill(); }
    } else if (f.type === 'tunnel') {
      // Brick oven tunnel: a dark band with arches at both mouths.
      bg.strokeStyle = 'rgba(60,32,18,.55)'; bg.lineWidth = 80; bg.lineCap = 'butt'; line(g); bg.stroke();
      for (const p of [g[0], g[g.length - 1]]) {
        bg.fillStyle = '#b55e3e'; bg.beginPath(); bg.arc(p.x, p.y, 54, Math.PI, 0); bg.lineTo(p.x + 54, p.y + 20); bg.lineTo(p.x - 54, p.y + 20); bg.closePath(); bg.fill();
        bg.fillStyle = '#2f1a10'; bg.beginPath(); bg.arc(p.x, p.y + 6, 36, Math.PI, 0); bg.lineTo(p.x + 36, p.y + 20); bg.lineTo(p.x - 36, p.y + 20); bg.closePath(); bg.fill();
      }
    } else if (f.type === 'portal') {
      const ends = [g[0], g[g.length - 1]], colors = ['#6fb3d9', '#d98fb7'];
      ends.forEach((p, i) => {
        const r = bg.createRadialGradient(p.x, p.y, 6, p.x, p.y, 58);
        r.addColorStop(0, '#fff'); r.addColorStop(.45, colors[i]); r.addColorStop(1, 'rgba(255,255,255,0)');
        bg.fillStyle = r; bg.beginPath(); bg.arc(p.x, p.y, 58, 0, 7); bg.fill();
        bg.strokeStyle = colors[i]; bg.lineWidth = 6; bg.beginPath(); bg.arc(p.x, p.y, 40, 0, 7); bg.stroke();
      });
    }
  }
  // Soft vignette makes the board read as a lit tabletop.
  const vig = bg.createRadialGradient(W / 2, H * .44, Math.min(W, H) * .36, W / 2, H / 2, Math.max(W, H) * .67);
  vig.addColorStop(0, 'rgba(60,30,10,0)'); vig.addColorStop(1, 'rgba(60,30,10,.24)');
  bg.fillStyle = vig; bg.fillRect(0, 0, W, H);
  // Slot pads: stone discs with a dashed rim, drawn by the frontend (no baked pads).
  for (const slot of map.slots) {
    if (deco.slot) { const d = (TD_SLOT_RADIUS + 8) * 2; bg.drawImage(deco.slot, slot.x - d / 2, slot.y - d * .42, d, d * .84); continue; }
    bg.save(); bg.translate(slot.x, slot.y); bg.scale(1, .82);
    bg.fillStyle = 'rgba(60,30,10,.25)'; bg.beginPath(); bg.arc(0, 8, TD_SLOT_RADIUS + 4, 0, 7); bg.fill();
    const g = bg.createRadialGradient(-12, -14, 4, 0, 0, TD_SLOT_RADIUS + 4);
    g.addColorStop(0, '#fbf3e4'); g.addColorStop(1, '#d9c6a6');
    bg.fillStyle = g; bg.beginPath(); bg.arc(0, 0, TD_SLOT_RADIUS + 2, 0, 7); bg.fill();
    bg.setLineDash([9, 7]); bg.strokeStyle = 'rgba(110,70,35,.45)'; bg.lineWidth = 3; bg.beginPath(); bg.arc(0, 0, TD_SLOT_RADIUS - 6, 0, 7); bg.stroke();
    bg.restore();
  }
  // Plate at the path end where the bread pile sits.
  if (deco.plate) bg.drawImage(deco.plate, end.x - 92, end.y - 46, 184, 115);
  else { bg.save(); bg.translate(end.x, end.y); bg.scale(.78, .78 * .62);
  bg.fillStyle = 'rgba(60,30,10,.28)'; bg.beginPath(); bg.arc(0, 14, 92, 0, 7); bg.fill();
  bg.fillStyle = '#fbf6ee'; bg.beginPath(); bg.arc(0, 0, 88, 0, 7); bg.fill();
  bg.strokeStyle = '#e7d9c4'; bg.lineWidth = 6; bg.beginPath(); bg.arc(0, 0, 70, 0, 7); bg.stroke();
  bg.restore(); }

  // Rounded photo tokens with a cream rim and shadow, one per tier.
  const tokens = tiers.map((_, i) => {
    const c = document.createElement('canvas'); c.width = c.height = 96;
    const b = c.getContext('2d')!;
    b.fillStyle = 'rgba(60,30,10,.3)'; b.beginPath(); b.arc(48, 52, 42, 0, 7); b.fill();
    b.fillStyle = CREAM; b.beginPath(); b.arc(48, 47, 43, 0, 7); b.fill();
    b.save(); b.beginPath(); b.arc(48, 47, 37, 0, 7); b.clip();
    const p = photos[i];
    if (p) { const s = Math.min(p.width, p.height); b.drawImage(p, (p.width - s) / 2, (p.height - s) / 2, s, s, 11, 10, 74, 74); }
    else { b.fillStyle = '#d9a35f'; b.fillRect(0, 0, 96, 96); }
    b.restore();
    return c;
  });
  const token = (tier: number) => tokens[Math.max(0, Math.min(tokens.length - 1, tier))];
  const PILE: [number, number][] = [[-48, 18], [-16, 22], [16, 22], [48, 18], [-32, -2], [0, 2], [32, -2], [-16, -22], [16, -22], [0, -42]];

  // ---- effect pool -----------------------------------------------------------------
  const fxKind = new Uint8Array(FX) as Uint8Array & { [i: number]: FxKind }, fxX = new Float32Array(FX), fxY = new Float32Array(FX), fxT = new Float64Array(FX), fxV = new Int32Array(FX);
  let fxNext = 0;
  const spawn = (kind: FxKind, x: number, y: number, tick: number, value = 0) => { const i = fxNext; fxNext = (fxNext + 1) % FX; fxKind[i] = kind; fxX[i] = x; fxY[i] = y; fxT[i] = tick; fxV[i] = value; };
  const hitAt = new Map<number, number>();
  const placedAt = new Float64Array(map.slots.length).fill(-1000);
  let shakeUntil = -1, bossAt = -1000;
  const ahead = new Float32Array(12);
  const clutterHitAt = new Map<number, number>(), clutterClearAt = new Map<number, number>();
  const clutterArts = { flourSack: clutterArt('flourSack'), eggCrate: clutterArt('eggCrate'), milkCan: clutterArt('milkCan') };
  const hasForks = (map.features ?? []).some(f => f.type === 'fork');
  const strips = (map.features ?? []).filter(f => f.type === 'strip' && f.geometry && f.geometry.length > 1).map(f => f.geometry!);

  function sprite(s: TdSprite | undefined, frameIndex: number, x: number, y: number, width: number, flip = false, rot = 0, sy = 1) {
    if (!s) return false;
    const f = s.asset.frames[frameIndex % s.asset.frames.length], r = f.rect, a = f.anchor, k = width / s.asset.frameSize[0];
    if (!flip && !rot && sy === 1) { ctx.drawImage(s.image, r[0], r[1], r[2], r[3], x - a[0] * k, y - a[1] * k, r[2] * k, r[3] * k); return true; }
    ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(rot); ctx.scale(flip ? -1 : 1, sy);
    ctx.drawImage(s.image, r[0], r[1], r[2], r[3], -a[0] * k, -a[1] * k, r[2] * k, r[3] * k);
    ctx.restore(); return true;
  }
  const shadow = (x: number, y: number, rx: number, ry: number, a = .28) => {
    ctx.fillStyle = `rgba(60,30,10,${a})`; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 7); ctx.fill();
  };

  function ingest(events: TdEvent[], s: TdState) {
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.type === 'hit') { hitAt.set(e.pest, e.tick); const p = s.pests.find(v => v.id === e.pest); if (p && !reduced) spawn(1, p.x, p.y - 20, e.tick); }
      else if (e.type === 'kill') { spawn(2, e.x, e.y - 30, e.tick, e.bounty); if (!reduced) spawn(1, e.x, e.y - 10, e.tick); hitAt.delete(e.pest); }
      else if (e.type === 'place' || e.type === 'upgrade' || e.type === 'build') { placedAt[e.slot] = e.tick; if (!reduced) spawn(4, map.slots[e.slot].x, map.slots[e.slot].y, e.tick); }
      else if (e.type === 'bossSpawn') { bossAt = e.tick; if (!reduced) shakeUntil = e.tick + 24; }
      else if (e.type === 'bossPhase') { const p = s.pests.find(v => v.id === e.pest); if (p) spawn(6, p.x, p.y - 40, e.tick); if (!reduced) shakeUntil = e.tick + 14; }
      else if (e.type === 'clutterHit') {
        clutterHitAt.set(e.clutter, e.tick);
        const c = s.clutter.find(v => v.id === e.clutter);
        if (c) { spawn(5, c.x, c.y, e.tick, e.slot); if (!reduced) spawn(1, c.x, c.y - 10, e.tick); }
      } else if (e.type === 'clutterCleared') {
        clutterClearAt.set(e.clutter, e.tick);
        const c = s.clutter.find(v => v.id === e.clutter);
        if (c) { spawn(2, c.x, c.y - 40, e.tick, e.reward); if (!reduced) spawn(4, c.x, c.y + 20, e.tick); }
      }
      else if (e.type === 'lose' && !reduced) shakeUntil = e.tick + 10;
    }
  }

  function draw(s: TdState, selected: number | null, preview: TowerKind | null) {
    const tick = s.tick;
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    if (tick < shakeUntil) { const m = (shakeUntil - tick) / 24 * 7; ctx.translate(Math.sin(tick * 1.9) * m, Math.cos(tick * 2.3) * m); }
    ctx.drawImage(layer, 0, 0);

    // Conveyor arrows run along the belt (static when reduced) so the speed-up reads at a glance.
    if (strips.length) {
      const t0 = reduced ? 0 : tick * 1.6;
      ctx.fillStyle = 'rgba(255,214,102,.95)';
      for (const g of strips) for (let i = 1; i < g.length; i++) {
        const a = g[i - 1], b = g[i], d = Math.hypot(b.x - a.x, b.y - a.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
        const gap = d < 92 ? Math.max(18, d / 2) : 46; for (let t = (d < 92 ? 0 : 12) + t0 % gap + (d < 92 ? gap / 2 - 9 : 0); t < d - 4; t += gap) { ctx.save(); ctx.translate(a.x + (b.x - a.x) * t / d, a.y + (b.y - a.y) * t / d); ctx.rotate(ang); ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-6, -18); ctx.lineTo(1, 0); ctx.lineTo(-6, 18); ctx.closePath(); ctx.fill(); ctx.restore(); }
      }
    }

    // Empty-slot affordance: a breathing "+" when anything is affordable.
    const afford = s.coins >= 60 && !s.over;
    const pulse = reduced ? .5 : .5 + .5 * Math.sin(tick * .1);
    for (let i = 0; i < map.slots.length; i++) {
      const sl = map.slots[i];
      let built = false; for (let j = 0; j < s.towers.length; j++) if (s.towers[j].slot === i) { built = true; break; }
      if (built) continue;
      ctx.globalAlpha = afford ? .55 + .45 * pulse : .35;
      ctx.strokeStyle = afford ? '#b06f2c' : 'rgba(110,70,35,.6)'; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sl.x - 12, sl.y); ctx.lineTo(sl.x + 12, sl.y); ctx.moveTo(sl.x, sl.y - 12); ctx.lineTo(sl.x, sl.y + 12); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Sifter auras and the selected range preview sit under everything else.
    for (let i = 0; i < s.towers.length; i++) {
      const t = s.towers[i]; if (t.kind !== 'flourSifter') continue;
      const r = towerStats(t.kind, t.level, t.branch).range;
      ctx.fillStyle = `rgba(255,252,244,${.16 + .06 * pulse})`; ctx.beginPath(); ctx.ellipse(t.x, t.y, r, r * .82, 0, 0, 7); ctx.fill();
    }
    if (selected !== null) {
      const sl = map.slots[selected];
      let tw = null; for (let j = 0; j < s.towers.length; j++) if (s.towers[j].slot === selected) tw = s.towers[j];
      const kind = tw ? tw.kind : preview;
      ctx.strokeStyle = GOLD; ctx.lineWidth = 5; ctx.beginPath(); ctx.ellipse(sl.x, sl.y, TD_SLOT_RADIUS + 6, (TD_SLOT_RADIUS + 6) * .82, 0, 0, 7); ctx.stroke();
      if (kind) {
        const r = towerStats(kind, tw ? tw.level : 0, tw ? tw.branch : null).range;
        ctx.fillStyle = 'rgba(242,193,78,.14)'; ctx.strokeStyle = 'rgba(242,193,78,.85)'; ctx.lineWidth = 3; ctx.setLineDash([12, 10]);
        ctx.beginPath(); ctx.ellipse(sl.x, sl.y, r, r * .82, 0, 0, 7); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
      }
    }

    // Bread pile on the plate: the owner's photos, most expensive on top.
    const pile = s.breadTiers;
    for (let i = 0; i < pile.length && i < PILE.length; i++) ctx.drawImage(token(pile[i]), end.x + PILE[i][0] * .8 - PHOTO, end.y + PILE[i][1] * .65 - PHOTO - 8, PHOTO * 2, PHOTO * 2);
    // Dropped bread rolls home along the path.
    for (let i = 0; i < s.dropped.length; i++) {
      const d = s.dropped[i];
      ctx.save(); ctx.translate(d.x, d.y - 18); if (!reduced) ctx.rotate(d.distance / 600);
      ctx.drawImage(token(d.tier), -PHOTO, -PHOTO, PHOTO * 2, PHOTO * 2); ctx.restore();
    }

    // Piping-bag cream lines: glossy white ribbons on the road.
    for (let i = 0; i < s.creamLines.length; i++) {
      const c = s.creamLines[i];
      for (const g of c.geometries.length ? c.geometries : [c.geometry]) {
        if (g.length < 2) continue;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(255,253,246,.92)'; ctx.lineWidth = 22; ctx.beginPath(); ctx.moveTo(g[0].x, g[0].y); for (let k = 1; k < g.length; k++) ctx.lineTo(g[k].x, g[k].y); ctx.stroke();
        ctx.strokeStyle = 'rgba(240,200,190,.8)'; ctx.lineWidth = 4; ctx.stroke();
      }
    }
    // Switchable forks: an arrow sign showing which branch new pests take.
    const feats = map.features ?? [];
    for (let i = 0; i < feats.length; i++) {
      const f = feats[i]; if (f.type !== 'fork' || !f.switchable) continue;
      const branches = f.branches ?? f.geometries ?? []; const choice = s.switches[f.id] ?? 0, b = branches[choice];
      const at = f.geometry[0]; if (!at || !b || b.length < 2) continue;
      const ang = Math.atan2(b[1].y - b[0].y, b[1].x - b[0].x);
      ctx.save(); ctx.translate(at.x, at.y - 70);
      ctx.fillStyle = '#fff8ec'; ctx.strokeStyle = '#c27a5f'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 0, 34, 0, 7); ctx.fill(); ctx.stroke();
      ctx.rotate(ang); ctx.fillStyle = '#c27a5f'; ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(-6, -16); ctx.lineTo(-6, -6); ctx.lineTo(-18, -6); ctx.lineTo(-18, 6); ctx.lineTo(-6, 6); ctx.lineTo(-6, 16); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // Whisk batter: sticky yellow puddles on the path.
    for (let i = 0; i < s.batterPuddles.length; i++) {
      const b = s.batterPuddles[i], left = Math.max(0, Math.min(1, (b.until - tick) / 30));
      ctx.globalAlpha = .55 * left + .2;
      ctx.fillStyle = '#f3d27a'; ctx.beginPath(); ctx.ellipse(b.x, b.y, b.radius, b.radius * .62, 0, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.ellipse(b.x - b.radius * .3, b.y - b.radius * .15, b.radius * .25, b.radius * .1, -.3, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // Bakery clutter: tap to send the towers at it. A fixed coin badge shows the reward until it breaks.
    for (let i = 0; i < s.clutter.length; i++) {
      const c = s.clutter[i], art2 = clutterArts[c.kind];
      if (c.hp > 0) {
        const age = tick - (clutterHitAt.get(c.id) ?? -100), amp = !reduced && age >= 0 && age < 8 ? (8 - age) / 8 * 5 : 0;
        const cx = c.x + Math.sin(tick * 3.1) * amp, cy = c.y - (amp ? Math.abs(Math.sin(tick * 2.3)) * amp * .6 : 0);
        ctx.drawImage(art2, cx - CL / 2, cy - CL / 2 - 4, CL, CL);
        const dmg = 1 - c.hp / c.maxHp;
        if (dmg > .02) {
          ctx.strokeStyle = 'rgba(55,32,18,.85)'; ctx.lineWidth = 3.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
          ctx.moveTo(cx - 4, cy - 38); ctx.lineTo(cx + 6, cy - 22); ctx.lineTo(cx - 5, cy - 8);
          if (dmg > .3) { ctx.lineTo(cx + 6, cy + 8); ctx.moveTo(cx + 6, cy - 22); ctx.lineTo(cx + 22, cy - 16); }
          if (dmg > .6) { ctx.moveTo(cx - 5, cy - 8); ctx.lineTo(cx - 22, cy - 2); ctx.moveTo(cx + 6, cy + 8); ctx.lineTo(cx + 16, cy + 26); }
          if (dmg > .85) { ctx.moveTo(cx - 22, cy - 2); ctx.lineTo(cx - 30, cy + 16); ctx.moveTo(cx + 22, cy - 16); ctx.lineTo(cx + 34, cy - 4); }
          ctx.stroke();
        }
        if (s.targetClutter === c.id) {
          ctx.strokeStyle = GOLD; ctx.lineWidth = 5; ctx.setLineDash([14, 10]); ctx.lineDashOffset = reduced ? 0 : -tick * .8;
          ctx.beginPath(); ctx.ellipse(c.x, c.y + 4, 68, 58, 0, 0, 7); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
          ctx.strokeStyle = 'rgba(255,248,236,.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(c.x, c.y + 4, 74, 64, 0, 0, 7); ctx.stroke();
        }
        if (c.hp < c.maxHp) {
          const k = c.hp / c.maxHp;
          ctx.fillStyle = 'rgba(40,24,14,.55)'; ctx.beginPath(); ctx.roundRect(c.x - 36, c.y + 62, 72, 11, 5.5); ctx.fill();
          ctx.fillStyle = k > .5 ? '#7cc06a' : k > .25 ? '#f0b54a' : '#e0583e'; ctx.beginPath(); ctx.roundRect(c.x - 33, c.y + 65, 66 * k, 5, 2.5); ctx.fill();
        } else {
          const on = s.targetClutter === c.id;
          ctx.fillStyle = on ? GOLD : 'rgba(255,248,236,.95)'; ctx.strokeStyle = on ? '#a8701f' : '#e2cfb1'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.roundRect(c.x - 34, c.y + 60, 68, 28, 14); ctx.fill(); ctx.stroke();
          ctx.fillStyle = GOLD; ctx.strokeStyle = '#a8701f'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(c.x - 17, c.y + 74, 9, 0, 7); ctx.fill(); ctx.stroke();
          ctx.fillStyle = INK; ctx.font = '700 20px ui-rounded, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(c.reward), c.x + 11, c.y + 81);
        }
      } else {
        const gone = tick - (clutterClearAt.get(c.id) ?? -100);
        if (gone >= 0 && gone < 14 && !reduced) {
          const k = gone / 14; ctx.globalAlpha = 1 - k; const sc = 1 + k * .25;
          ctx.drawImage(art2, c.x - CL / 2 * sc, c.y - CL / 2 * sc - 4 - k * 14, CL * sc, CL * sc); ctx.globalAlpha = 1;
        } else {
          // Rubble: a few crumbs where it stood.
          ctx.fillStyle = 'rgba(60,30,10,.18)'; ctx.beginPath(); ctx.ellipse(c.x, c.y + 38, 44, 11, 0, 0, 7); ctx.fill();
          ctx.fillStyle = clutterDebris[c.kind];
          for (let d = 0; d < 5; d++) { ctx.beginPath(); ctx.ellipse(c.x - 28 + d * 14, c.y + 36 + (d % 2) * 6, 8 - d % 3, 4, d, 0, 7); ctx.fill(); }
        }
      }
    }
    // Towers: shadow, placement bounce, attack recoil, tier pips.
    for (let i = 0; i < s.towers.length; i++) {
      const t = s.towers[i];
      const age = tick - placedAt[t.slot];
      let sx = 1, sy = 1;
      if (!reduced && age >= 0 && age < 18) { const k = age / 18; sy = 1 + Math.sin(k * Math.PI) * .25 * (1 - k); sx = 2 - sy; }
      if (!reduced && t.lastAttackTick !== null && tick - t.lastAttackTick < 8) { const k = (tick - t.lastAttackTick) / 8; sy *= 1 - .1 * (1 - k); sx *= 1 + .06 * (1 - k); }
      shadow(t.x, t.y + 10, 62, 24);
      const name = `${towerNames[t.kind]}-${t.level}`;
      if (sprite(art[name], 0, t.x, t.y + 6, TOWER_W * sx, false, 0, sy / sx)) { /* drawn */ }
      else { ctx.fillStyle = CREAM; ctx.beginPath(); ctx.arc(t.x, t.y - 10, 30, 0, 7); ctx.fill(); }
      for (let p = 0; p <= t.level; p++) {
        const px = t.x - t.level * 10 + p * 20, py = t.y + 44;
        ctx.fillStyle = p === 2 && t.branch ? (t.branch === 'a' ? '#e07a3f' : '#4f8fc0') : GOLD;
        ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, 6, 0, 7); ctx.fill(); ctx.stroke();
      }
    }

    // Pests: y-sorted would cost an allocation; path order is close enough at this scale.
    let bossPest: TdState['pests'][number] | null = null;
    for (let i = 0; i < s.pests.length; i++) {
      const p = s.pests[i];
      if (p.inTunnel) continue; // hidden (and untargetable) inside an oven tunnel
      const boss = !!p.boss, w = PEST_W * (boss ? BOSS_SCALE : p.tiny ? TINY_SCALE : 1);
      if (boss) bossPest = p;
      const tele = boss && tick < p.telegraphUntil, dash = boss && !tele && tick < p.dashUntil;
      const ww = tele ? w * 1.08 : w, sqy = tele ? .84 : 1, px = tele && !reduced ? p.x + Math.sin(tick * 2.4) * 3 : p.x;
      if (tele) {
        // Warning (0.8 s): a red lane along the road ahead and a red ring under the crouching boss.
        const beat = reduced ? 1 : .65 + .35 * Math.sin(tick * .5);
        for (let j = 0; j <= 4; j++) { const q = pathPosition(map, p.distance + (110 + j * 46) * SUBUNITS); ahead[j * 2] = q.x; ahead[j * 2 + 1] = q.y; }
        ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = `rgba(224,88,62,${.2 * beat})`; ctx.lineWidth = 64;
        ctx.beginPath(); ctx.moveTo(ahead[0], ahead[1]); for (let j = 1; j <= 4; j++) ctx.lineTo(ahead[j * 2], ahead[j * 2 + 1]); ctx.stroke();
        ctx.strokeStyle = '#e0583e'; ctx.lineWidth = 8;
        for (let j = 1; j <= 4; j++) {
          const mx = (ahead[j * 2] + ahead[j * 2 - 2]) / 2, my = (ahead[j * 2 + 1] + ahead[j * 2 - 1]) / 2, a = Math.atan2(ahead[j * 2 + 1] - ahead[j * 2 - 1], ahead[j * 2] - ahead[j * 2 - 2]);
          ctx.globalAlpha = Math.min(1, beat * (1.2 - j * .18)); ctx.save(); ctx.translate(mx, my); ctx.rotate(a);
          ctx.beginPath(); ctx.moveTo(-9, -16); ctx.lineTo(7, 0); ctx.lineTo(-9, 16); ctx.stroke(); ctx.restore();
        }
        ctx.globalAlpha = .55 * beat; ctx.fillStyle = '#e0583e'; ctx.beginPath(); ctx.ellipse(p.x, p.y + 6, w * .42, w * .14, 0, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      } else if (dash && !reduced) {
        // Dash: speed streaks trail behind.
        const a = p.heading * Math.PI / 180; ctx.strokeStyle = 'rgba(224,88,62,.7)'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.beginPath();
        for (let j = -1; j <= 1; j++) {
          const ox = -Math.sin(a) * j * 26, oy = Math.cos(a) * j * 20 - 30;
          ctx.moveTo(p.x + ox - Math.cos(a) * 40, p.y + oy - Math.sin(a) * 40); ctx.lineTo(p.x + ox - Math.cos(a) * 130, p.y + oy - Math.sin(a) * 130);
        }
        ctx.stroke();
      }
      const flying = p.kind === 'sparrow';
      const h = ((p.heading % 360) + 360) % 360;
      const flip = h > 90 && h < 270;
      const tilt = Math.sin(h * Math.PI / 180) * (flip ? -1 : 1) * .35;
      const frame = reduced ? 0 : Math.floor((tick + p.id * 5) * (flying ? 10 : 8) / 60);
      const lift = flying ? 26 + (reduced ? 0 : Math.sin((tick + p.id * 9) * .2) * 5) : 0;
      shadow(p.x, p.y + 4, w * (flying ? .22 : .3), w * .1, flying ? .16 : .26);
      const s0 = boss ? art['pest-boss'] : art[pestNames[p.kind]];
      if (!sprite(s0, frame, px, p.y - lift, ww, flip, tilt, sqy)) { ctx.fillStyle = INK; ctx.beginPath(); ctx.ellipse(p.x, p.y - lift, w * .22, w * .14, 0, 0, 7); ctx.fill(); }
      const hit = hitAt.get(p.id);
      if (hit !== undefined && tick - hit < 6 && !reduced) {
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .55 * (1 - (tick - hit) / 6);
        sprite(s0, frame, px, p.y - lift, ww, flip, tilt, sqy); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      }
      if (tele || dash) {
        // Red flash on the boss; the "!" marks the moment it cannot be hurt.
        if (tele && !reduced && ((tick >> 2) & 1)) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .4; sprite(s0, frame, px, p.y - lift, ww, flip, tilt, sqy); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
        if (tele) {
          ctx.fillStyle = '#e0583e'; ctx.strokeStyle = CREAM; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(p.x, p.y - lift - w * .62, 18, 0, 7); ctx.fill(); ctx.stroke();
          ctx.fillStyle = CREAM; ctx.font = '900 24px ui-rounded, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('!', p.x, p.y - lift - w * .62 + 8);
        }
      }
      if (tick < p.frozenUntil) {
        ctx.globalAlpha = .55; ctx.fillStyle = '#bfe3f5'; ctx.beginPath(); ctx.ellipse(p.x, p.y - lift - w * .12, w * .34, w * .24, 0, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      }
      if (p.floured) {
        // Flour dust: pale motes circling the pest (it takes extra damage).
        ctx.fillStyle = 'rgba(255,255,255,.9)';
        for (let d = 0; d < 4; d++) { const a = (tick * .08 + d * 1.57 + p.id); ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * w * .26, p.y - lift - 12 + Math.sin(a) * 9, 4, 0, 7); ctx.fill(); }
      } else if (p.slowed) {
        ctx.fillStyle = 'rgba(255,255,255,.7)';
        for (let d = 0; d < 2; d++) { const a = (tick * .08 + d * 3.1 + p.id); ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * w * .24, p.y - lift - 10 + Math.sin(a) * 8, 3, 0, 7); ctx.fill(); }
      }
      if (p.burning && !reduced) {
        // Flicker of flame above the back.
        const f = .7 + .3 * Math.sin(tick * .6 + p.id);
        const g = ctx.createRadialGradient(p.x, p.y - lift - w * .25, 0, p.x, p.y - lift - w * .25, w * .3 * f);
        g.addColorStop(0, 'rgba(255,220,120,.95)'); g.addColorStop(.5, 'rgba(255,140,50,.7)'); g.addColorStop(1, 'rgba(255,90,30,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y - lift - w * .25, w * .3 * f, 0, 7); ctx.fill();
      }
      if (tick < p.stunnedUntil) {
        // Stun: three little stars orbiting the head.
        ctx.fillStyle = GOLD; ctx.strokeStyle = '#a8701f'; ctx.lineWidth = 1.5;
        for (let d = 0; d < 3; d++) {
          const a = tick * .2 + d * 2.09, sx = p.x + Math.cos(a) * w * .22, sy = p.y - lift - w * .42 + Math.sin(a) * 6;
          ctx.beginPath();
          for (let k = 0; k < 10; k++) { const r = k % 2 ? 3 : 7, t2 = k * Math.PI / 5 - Math.PI / 2; ctx.lineTo(sx + Math.cos(t2) * r, sy + Math.sin(t2) * r); }
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
      }
      // Carried bread rides above the thief.
      for (let c = 0; c < p.carriedTiers.length; c++) {
        const bob = reduced ? 0 : Math.sin((tick + p.id * 7) * .25) * 3;
        ctx.drawImage(token(p.carriedTiers[c]), p.x - 26 + (c - (p.carriedTiers.length - 1) / 2) * 22, p.y - lift - w * .62 - 26 + bob - c * 6, 52, 52);
      }
      if (p.hp < p.maxHp && !boss && !p.tiny) {
        const bw = 44, by = p.y - lift - w * .5 - (p.carriedTiers.length ? 34 : 0);
        ctx.fillStyle = 'rgba(40,24,14,.55)'; ctx.beginPath(); ctx.roundRect(p.x - bw / 2 - 2, by - 2, bw + 4, 10, 5); ctx.fill();
        const k = Math.max(0, p.hp / p.maxHp);
        ctx.fillStyle = k > .5 ? '#7cc06a' : k > .25 ? '#f0b54a' : '#e0583e';
        ctx.beginPath(); ctx.roundRect(p.x - bw / 2, by, bw * k, 6, 3); ctx.fill();
      }
    }

    // Projectiles face their flight direction; the oven's fireball leaves a glow.
    for (let i = 0; i < s.projectiles.length; i++) {
      const p = s.projectiles[i];
      const ang = Math.atan2(p.targetY - p.fromY, p.targetX - p.fromX);
      if (p.kind === 'oven' && !reduced) {
        const g = ctx.createRadialGradient(p.x, p.y - 8, 0, p.x, p.y - 8, 26);
        g.addColorStop(0, 'rgba(255,190,90,.8)'); g.addColorStop(1, 'rgba(255,140,60,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y - 8, 26, 0, 7); ctx.fill();
      }
      if (!sprite(art[shotNames[p.kind]], 0, p.x, p.y, 48, false, reduced ? 0 : ang + (p.kind === 'rollingPin' ? tick * .4 : 0))) {
        ctx.fillStyle = '#e0583e'; ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, 7); ctx.fill();
      }
    }

    // Effects pool.
    ctx.textAlign = 'center'; ctx.font = '700 30px ui-rounded, system-ui, sans-serif';
    for (let i = 0; i < FX; i++) {
      const k = fxKind[i]; if (!k) continue;
      const age = tick - fxT[i];
      if (k === 1) { if (age > 15) { fxKind[i] = 0; continue; } sprite(art['fx-hit'], Math.floor(age / 4), fxX[i], fxY[i], 70); }
      else if (k === 2) {
        if (age > 40) { fxKind[i] = 0; continue; }
        const y = fxY[i] - age * 1.4, a = age < 28 ? 1 : 1 - (age - 28) / 12;
        ctx.globalAlpha = a;
        ctx.fillStyle = GOLD; ctx.strokeStyle = '#a8701f'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(fxX[i] - 26, y - 10, 11, 0, 7); ctx.fill(); ctx.stroke();
        ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(80,45,15,.8)'; ctx.strokeText(`+${fxV[i]}`, fxX[i] + 8, y); ctx.fillStyle = '#fff6dc'; ctx.fillText(`+${fxV[i]}`, fxX[i] + 8, y);
        ctx.globalAlpha = 1;
      } else if (k === 4) {
        if (age > 18) { fxKind[i] = 0; continue; }
        ctx.globalAlpha = 1 - age / 18; ctx.fillStyle = '#f3e6d0';
        for (let d = 0; d < 6; d++) { const a = d * 1.047; ctx.beginPath(); ctx.arc(fxX[i] + Math.cos(a) * (30 + age * 2.5), fxY[i] + 10 + Math.sin(a) * (12 + age), 8 - age * .3, 0, 7); ctx.fill(); }
        ctx.globalAlpha = 1;
      } else if (k === 5) {
        // Direct strike: a bright streak from the tower to the clutter.
        if (age > 7) { fxKind[i] = 0; continue; }
        const sl = map.slots[fxV[i]]; if (!sl) { fxKind[i] = 0; continue; }
        const head = Math.min(1, (age + 1) / 4), tail = Math.max(0, head - .45);
        ctx.lineCap = 'round'; ctx.globalAlpha = 1 - age / 8;
        ctx.strokeStyle = 'rgba(255,243,196,.95)'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(sl.x + (fxX[i] - sl.x) * tail, sl.y + (fxY[i] - sl.y) * tail); ctx.lineTo(sl.x + (fxX[i] - sl.x) * head, sl.y + (fxY[i] - sl.y) * head); ctx.stroke();
        ctx.strokeStyle = GOLD; ctx.lineWidth = 4; ctx.stroke(); ctx.globalAlpha = 1;
      } else if (k === 6) {
        // Phase change: the boss spits out five tiny mice; a red ring marks the burst.
        if (age > 34) { fxKind[i] = 0; continue; }
        const fade = 1 - age / 34, grow = reduced ? 1 : Math.min(1, age / 10);
        ctx.strokeStyle = '#e0583e'; ctx.lineWidth = 3 + 7 * fade; ctx.globalAlpha = .8 * fade;
        ctx.beginPath(); ctx.ellipse(fxX[i], fxY[i] + 40, 40 + 120 * grow, (40 + 120 * grow) * .55, 0, 0, 7); ctx.stroke();
        const t = reduced ? 1 : Math.min(1, age / 24), out = 1 - (1 - t) * (1 - t);
        ctx.globalAlpha = Math.min(1, fade * 2.2);
        for (let d = 0; d < 5; d++) {
          const a = d * 1.2566 - 1.5708, mx = fxX[i] + Math.cos(a) * 120 * out, my = fxY[i] + 40 + Math.sin(a) * 70 * out - Math.sin(t * Math.PI) * 46;
          sprite(art['pest-mouse'], reduced ? 0 : Math.floor(age / 4) + d, mx, my, PEST_W * TINY_SCALE, Math.cos(a) < 0);
        }
        ctx.globalAlpha = 1;
      }
    }
    if (bossPest) {
      // Boss bar: three segments (last to break on the left), a gold edge on the one that is guarded.
      const b = bossPest, hi1 = Math.ceil(b.maxHp * 2 / 3), hi0 = Math.ceil(b.maxHp / 3), bx = W / 2 - 250, by = 14, sw = 160, gap = 10;
      ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
      ctx.fillStyle = 'rgba(59,42,31,.78)'; ctx.beginPath(); ctx.roundRect(bx - 12, by - 6, 3 * sw + 2 * gap + 24, 36, 18); ctx.fill();
      const cur = b.hp > hi1 ? 2 : b.hp > hi0 ? 1 : 0, lo = [0, hi0, hi1][cur];
      const guard = tick < b.phaseReadyTick && b.hp <= lo + 1;
      for (let seg = 0; seg < 3; seg++) {
        const a = [0, hi0, hi1][seg], z = [hi0, hi1, b.maxHp][seg], k = Math.max(0, Math.min(1, (b.hp - a) / Math.max(1, z - a))), x = bx + seg * (sw + gap);
        ctx.fillStyle = 'rgba(255,248,236,.2)'; ctx.beginPath(); ctx.roundRect(x, by, sw, 24, 12); ctx.fill();
        if (k > 0) { ctx.fillStyle = seg === cur && b.hp - a < (z - a) * .34 ? '#f0b54a' : '#e0583e'; ctx.beginPath(); ctx.roundRect(x, by, Math.max(14, sw * k), 24, 12); ctx.fill(); }
        if (guard && seg === cur) { ctx.strokeStyle = GOLD; ctx.lineWidth = reduced ? 4 : 3.5 + Math.sin(tick * .3); ctx.beginPath(); ctx.roundRect(x - 2, by - 2, sw + 4, 28, 14); ctx.stroke(); }
      }
    }
    if (!reduced && tick - bossAt < 90) {
      ctx.globalAlpha = Math.min(1, (90 - (tick - bossAt)) / 20) * .22; ctx.fillStyle = '#e0583e'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
    }
  }

  return {
    draw, ingest,
    resize() {
      const rect = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(rect.width * dpr)); canvas.height = Math.max(1, Math.round(rect.height * dpr));
    },
  };
}

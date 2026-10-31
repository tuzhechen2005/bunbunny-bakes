import { START_BREAD, TD_MAPS, type TdState, type TowerKind, type PestKind } from '@/lib/td';
import type { TierView } from '@/components/game/types';
import type { TdArt, TdSprite } from './tdAssets';

const towerNames: Record<TowerKind, string[]> = {
  rollingPin: ['tower-pin-0', 'tower-pin-1', 'tower-pin-2'], flourSifter: ['tower-sifter-0', 'tower-sifter-1', 'tower-sifter-2'],
  whisk: ['tower-whisk-0', 'tower-whisk-1', 'tower-whisk-2'], oven: ['tower-oven-0', 'tower-oven-1', 'tower-oven-2'],
};
const pestNames: Record<PestKind, string> = { ant: 'pest-ant', mouse: 'pest-mouse', sparrow: 'pest-sparrow', beetle: 'pest-beetle' };
const shotNames: Record<TowerKind, string> = { rollingPin: 'proj-pin', flourSifter: '', whisk: 'proj-whisk', oven: 'proj-oven' };
function sprite(ctx: CanvasRenderingContext2D, s: TdSprite | undefined, x: number, y: number, width: number, tick: number, reduced: boolean): boolean {
  if (!s) return false;
  const frames = s.asset.frames;
  const age = reduced ? 0 : Math.floor(tick * (s.asset.fps ?? 0) / 60);
  const frame = frames[s.asset.loop === false ? Math.min(age, frames.length - 1) : age % frames.length];
  const r = frame.rect, a = frame.anchor, scale = width / s.asset.frameSize[0];
  ctx.drawImage(s.image, r[0], r[1], r[2], r[3], x - a[0] * scale, y - a[1] * scale, r[2] * scale, r[3] * scale);
  return true;
}
export async function breadImages(tiers: TierView[]): Promise<(HTMLImageElement | null)[]> {
  return Promise.all(tiers.map(async t => {
    if (!t.imageUrl) return null;
    try { const img = new Image(); img.src = t.imageUrl; await img.decode(); return img; } catch { return null; }
  }));
}
/** All geometry, colours and static layers are cached here, outside the allocation-free draw loop. */
export function createTdRenderer(canvas: HTMLCanvasElement, mapIndex: number, art: TdArt, tiers: TierView[], photos: (HTMLImageElement | null)[], reduced: boolean) {
  const ctx = canvas.getContext('2d')!;
  const style = getComputedStyle(canvas);
  const ink = style.getPropertyValue('--c-ink').trim(), paper = style.getPropertyValue('--c-paper').trim();
  const wash = style.getPropertyValue('--c-wash').trim(), line = style.getPropertyValue('--c-line').trim(), red = style.getPropertyValue('--c-red').trim();
  const map = TD_MAPS[mapIndex], end = map.path[map.path.length - 1];
  const layer = document.createElement('canvas'); layer.width = 720; layer.height = 1080;
  const bg = layer.getContext('2d')!;
  bg.fillStyle = wash; bg.fillRect(0, 0, 720, 1080);
  const background = art[`map-${mapIndex + 1}`];
  if (background) {
    const r = background.asset.frames[0].rect;
    bg.drawImage(background.image, r[0], r[1], r[2], r[3], 0, 0, 720, 1080);
  } else {
    bg.strokeStyle = line; bg.lineWidth = 44; bg.lineJoin = 'round'; bg.lineCap = 'round'; bg.beginPath();
    bg.moveTo(map.path[0].x, map.path[0].y);
    for (let i = 1; i < map.path.length; i++) bg.lineTo(map.path[i].x, map.path[i].y);
    bg.stroke();
  }
  for (const slot of map.slots) if (!sprite(bg, art.slot, slot.x, slot.y, 76, 0, true)) {
    bg.fillStyle = paper; bg.strokeStyle = line; bg.lineWidth = 3; bg.beginPath(); bg.arc(slot.x, slot.y, 35, 0, Math.PI * 2); bg.fill(); bg.stroke();
    bg.fillStyle = ink; bg.fillRect(slot.x - 10, slot.y - 2, 20, 4); bg.fillRect(slot.x - 2, slot.y - 10, 4, 20);
  }
  const breads = tiers.map((_, i) => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const b = c.getContext('2d')!;
    b.beginPath(); b.roundRect(1, 1, 62, 62, 12); b.clip(); b.fillStyle = paper; b.fillRect(0, 0, 64, 64);
    const photo = photos[i];
    if (photo) { const size = Math.min(photo.width, photo.height); b.drawImage(photo, (photo.width-size)/2, (photo.height-size)/2, size, size, 0, 0, 64, 64); }
    else { b.strokeStyle = ink; b.lineWidth = 3; b.beginPath(); b.ellipse(32, 34, 23, 16, -.2, 0, Math.PI*2); b.stroke(); }
    b.strokeStyle = line; b.lineWidth = 2; b.stroke();
    return c;
  });
  // Two rows on a tray. Each original bread keeps its position after a theft.
  const trayX = Math.max(8, Math.min(466, end.x - 119)), trayY = Math.min(970, end.y - 110);
  const tileX = Array.from({ length: START_BREAD }, (_, i) => trayX + 10 + i % 5 * 46);
  const tileY = Array.from({ length: START_BREAD }, (_, i) => trayY + 10 + Math.floor(i / 5) * 46);
  const lostAt = new Float64Array(START_BREAD).fill(-1);
  let previousBread = -1;
  bg.fillStyle = paper; bg.strokeStyle = line; bg.lineWidth = 3;
  bg.beginPath(); bg.roundRect(trayX, trayY, 246, 108, 16); bg.fill(); bg.stroke();
  return (s: TdState) => {
    ctx.setTransform(canvas.width / 720, 0, 0, canvas.height / 1080, 0, 0);
    ctx.drawImage(layer, 0, 0);
    if (previousBread >= 0 && s.bread < previousBread) {
      for (let i = START_BREAD - previousBread; i < START_BREAD - s.bread; i++) lostAt[i] = s.tick;
    }
    previousBread = s.bread;
    for (let i = 0; i < START_BREAD; i++) {
      const stolen = i < START_BREAD - s.bread;
      const age = lostAt[i] < 0 ? 1 : Math.min(1, (s.tick - lostAt[i]) / 18);
      // Terminal scenes stop drawing, so the last tile must disappear on their final frame.
      if (stolen && (age >= 1 || s.over)) continue;
      ctx.globalAlpha = stolen ? 1 - age : 1;
      const lift = stolen && !reduced ? age * 12 : 0;
      ctx.drawImage(breads[Math.floor(i * (tiers.length - 1) / (START_BREAD - 1))], tileX[i], tileY[i] - lift, 42, 42);
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < s.towers.length; i++) {
      const t = s.towers[i];
      if (!sprite(ctx, art[towerNames[t.kind][t.level]], t.x, t.y, 100, s.tick, reduced)) {
        ctx.fillStyle = paper; ctx.strokeStyle = ink; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(t.x, t.y, 27+t.level*4, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        if (t.kind === 'rollingPin') ctx.fillRect(t.x-32, t.y-6, 64, 12);
        else if (t.kind === 'oven') ctx.strokeRect(t.x-18, t.y-18, 36, 30);
        else { ctx.beginPath(); ctx.ellipse(t.x, t.y-5, t.kind === 'whisk' ? 10 : 22, 18, 0, 0, Math.PI*2); ctx.stroke(); }
      }
    }
    for (let i = 0; i < s.pests.length; i++) {
      const p = s.pests[i];
      if (!sprite(ctx, art[pestNames[p.kind]], p.x, p.y, 65, s.tick, reduced)) {
        ctx.fillStyle = p.slowed ? line : ink; ctx.beginPath(); ctx.ellipse(p.x,p.y, p.kind === 'ant' ? 12 : 19, 13, 0, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(p.x+16, p.y-3, 8, 0, Math.PI*2); ctx.fill();
      }
      ctx.fillStyle = line; ctx.fillRect(p.x-18,p.y-30,36,4); ctx.fillStyle = red; ctx.fillRect(p.x-18,p.y-30,36*p.hp/p.maxHp,4);
    }
    for (let i = 0; i < s.projectiles.length; i++) {
      const p = s.projectiles[i];
      if (!sprite(ctx, art[shotNames[p.kind]], p.x, p.y, 30, s.tick, reduced)) { ctx.fillStyle=red; ctx.beginPath(); ctx.arc(p.x,p.y,6,0,Math.PI*2); ctx.fill(); }
    }
    if (!reduced) for (let i = 0; i < s.events.length; i++) {
      const e = s.events[i]; if (e.type !== 'hit') continue;
      for (let j = 0; j < s.pests.length; j++) if (s.pests[j].id === e.pest) sprite(ctx, art['fx-hit'], s.pests[j].x, s.pests[j].y, 60, s.tick-e.tick, false);
    }
  };
}

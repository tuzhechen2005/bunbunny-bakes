import { FIELD_WIDTH as W, FIELD_HEIGHT as H, TD_MAPS, TD_SLOT_RADIUS, towerStats, type TdEvent, type TdState, type TowerKind, type PestKind } from '@/lib/td';
import type { TierView } from '@/components/game/types';
import type { TdArt, TdSprite } from './tdAssets';

// Canvas 2D in field units (FIELD_WIDTH×FIELD_HEIGHT). Static map + slots are cached; the frame loop
// reuses a fixed effect pool and never allocates. Game art colours live here, like SVG art.
const towerNames: Record<TowerKind, string> = { rollingPin: 'tower-pin', flourSifter: 'tower-sifter', whisk: 'tower-whisk', oven: 'tower-oven' };
const pestNames: Record<PestKind, string> = { ant: 'pest-ant', mouse: 'pest-mouse', sparrow: 'pest-sparrow', beetle: 'pest-beetle' };
const shotNames: Record<TowerKind, string> = { rollingPin: 'proj-pin', flourSifter: '', whisk: 'proj-whisk', oven: 'proj-oven' };
const TOWER_W = 150, PEST_W = 110, BOSS_SCALE = 1.75, PHOTO = 28;
const FX = 64;
type FxKind = 0 | 1 | 2 | 3 | 4; // none, puff, coin, ring, dust
const GOLD = '#f2c14e', INK = '#3b2a1f', CREAM = '#fff8ec';

export async function breadImages(tiers: TierView[]): Promise<(HTMLImageElement | null)[]> {
  return Promise.all(tiers.map(async t => {
    if (!t.imageUrl) return null;
    try { const img = new Image(); img.crossOrigin = 'anonymous'; img.src = t.imageUrl; await img.decode(); return img; } catch { return null; }
  }));
}

export interface TdView { draw(s: TdState, selected: number | null, preview: TowerKind | null): void; ingest(events: TdEvent[], s: TdState): void; resize(): void }

export function createTdRenderer(canvas: HTMLCanvasElement, mapIndex: number, art: TdArt, tiers: TierView[], photos: (HTMLImageElement | null)[], reduced: boolean): TdView {
  const ctx = canvas.getContext('2d')!;
  const map = TD_MAPS[mapIndex], last = map.path[map.path.length - 1];
  // The path exits the board; the plate sits just inside so the whole pile stays visible.
  const inside = (v: number, max: number) => Math.max(110, Math.min(max - 110, v));
  // Portrait maps exit at the bottom, landscape maps on the right: step back inside along the last segment.
  const prev = map.path[map.path.length - 2] ?? last, len = Math.hypot(last.x - prev.x, last.y - prev.y) || 1;
  const end = { x: inside(last.x - (last.x - prev.x) / len * 40, W), y: inside(last.y - (last.y - prev.y) / len * 40, H) };
  const layer = document.createElement('canvas'); layer.width = W; layer.height = H;
  const bg = layer.getContext('2d')!;
  bg.fillStyle = '#e9dcc6'; bg.fillRect(0, 0, W, H);
  const background = art[`map-${mapIndex + 1}`];
  if (background) { const r = background.asset.frames[0].rect; bg.drawImage(background.image, r[0], r[1], r[2], r[3], 0, 0, W, H); }
  else {
    bg.strokeStyle = '#d6c3a5'; bg.lineWidth = 56; bg.lineJoin = 'round'; bg.lineCap = 'round'; bg.beginPath();
    bg.moveTo(map.path[0].x, map.path[0].y); for (let i = 1; i < map.path.length; i++) bg.lineTo(map.path[i].x, map.path[i].y); bg.stroke();
  }
  // Soft vignette makes the board read as a lit tabletop.
  const vig = bg.createRadialGradient(W / 2, H * .44, Math.min(W, H) * .36, W / 2, H / 2, Math.max(W, H) * .67);
  vig.addColorStop(0, 'rgba(60,30,10,0)'); vig.addColorStop(1, 'rgba(60,30,10,.28)');
  bg.fillStyle = vig; bg.fillRect(0, 0, W, H);
  // Slot pads: stone discs with a dashed rim, drawn by the frontend (no baked pads).
  for (const slot of map.slots) {
    bg.save(); bg.translate(slot.x, slot.y); bg.scale(1, .82);
    bg.fillStyle = 'rgba(60,30,10,.25)'; bg.beginPath(); bg.arc(0, 8, TD_SLOT_RADIUS + 4, 0, 7); bg.fill();
    const g = bg.createRadialGradient(-12, -14, 4, 0, 0, TD_SLOT_RADIUS + 4);
    g.addColorStop(0, '#fbf3e4'); g.addColorStop(1, '#d9c6a6');
    bg.fillStyle = g; bg.beginPath(); bg.arc(0, 0, TD_SLOT_RADIUS + 2, 0, 7); bg.fill();
    bg.setLineDash([9, 7]); bg.strokeStyle = 'rgba(110,70,35,.45)'; bg.lineWidth = 3; bg.beginPath(); bg.arc(0, 0, TD_SLOT_RADIUS - 6, 0, 7); bg.stroke();
    bg.restore();
  }
  // Plate at the path end where the bread pile sits.
  bg.save(); bg.translate(end.x, end.y); bg.scale(.78, .78 * .62);
  bg.fillStyle = 'rgba(60,30,10,.28)'; bg.beginPath(); bg.arc(0, 14, 92, 0, 7); bg.fill();
  bg.fillStyle = '#fbf6ee'; bg.beginPath(); bg.arc(0, 0, 88, 0, 7); bg.fill();
  bg.strokeStyle = '#e7d9c4'; bg.lineWidth = 6; bg.beginPath(); bg.arc(0, 0, 70, 0, 7); bg.stroke();
  bg.restore();

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
      else if (e.type === 'lose' && !reduced) shakeUntil = e.tick + 10;
    }
  }

  function draw(s: TdState, selected: number | null, preview: TowerKind | null) {
    const tick = s.tick;
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    if (tick < shakeUntil) { const m = (shakeUntil - tick) / 24 * 7; ctx.translate(Math.sin(tick * 1.9) * m, Math.cos(tick * 2.3) * m); }
    ctx.drawImage(layer, 0, 0);

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

    // Whisk batter: sticky yellow puddles on the path.
    for (let i = 0; i < s.batterPuddles.length; i++) {
      const b = s.batterPuddles[i], left = Math.max(0, Math.min(1, (b.until - tick) / 30));
      ctx.globalAlpha = .55 * left + .2;
      ctx.fillStyle = '#f3d27a'; ctx.beginPath(); ctx.ellipse(b.x, b.y, b.radius, b.radius * .62, 0, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.ellipse(b.x - b.radius * .3, b.y - b.radius * .15, b.radius * .25, b.radius * .1, -.3, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // Towers: shadow, placement bounce, attack recoil, tier pips.
    for (let i = 0; i < s.towers.length; i++) {
      const t = s.towers[i];
      const age = tick - placedAt[t.slot];
      let sx = 1, sy = 1;
      if (!reduced && age >= 0 && age < 18) { const k = age / 18; sy = 1 + Math.sin(k * Math.PI) * .25 * (1 - k); sx = 2 - sy; }
      if (!reduced && t.lastAttackTick !== null && tick - t.lastAttackTick < 8) { const k = (tick - t.lastAttackTick) / 8; sy *= 1 - .1 * (1 - k); sx *= 1 + .06 * (1 - k); }
      shadow(t.x, t.y + 8, 46, 18);
      const name = `${towerNames[t.kind]}-${t.level}`;
      if (sprite(art[name], 0, t.x, t.y + 6, TOWER_W * sx, false, 0, sy / sx)) { /* drawn */ }
      else { ctx.fillStyle = CREAM; ctx.beginPath(); ctx.arc(t.x, t.y - 10, 30, 0, 7); ctx.fill(); }
      for (let p = 0; p <= t.level; p++) {
        const px = t.x - t.level * 9 + p * 18, py = t.y + 34;
        ctx.fillStyle = p === 2 && t.branch ? (t.branch === 'a' ? '#e07a3f' : '#4f8fc0') : GOLD;
        ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, 6, 0, 7); ctx.fill(); ctx.stroke();
      }
    }

    // Pests: y-sorted would cost an allocation; path order is close enough at this scale.
    for (let i = 0; i < s.pests.length; i++) {
      const p = s.pests[i];
      const boss = !!p.boss, w = PEST_W * (boss ? BOSS_SCALE : 1);
      const flying = p.kind === 'sparrow';
      const h = ((p.heading % 360) + 360) % 360;
      const flip = h > 90 && h < 270;
      const tilt = Math.sin(h * Math.PI / 180) * (flip ? -1 : 1) * .35;
      const frame = reduced ? 0 : Math.floor((tick + p.id * 5) * (flying ? 10 : 8) / 60);
      const lift = flying ? 26 + (reduced ? 0 : Math.sin((tick + p.id * 9) * .2) * 5) : 0;
      shadow(p.x, p.y + 4, w * (flying ? .22 : .3), w * .1, flying ? .16 : .26);
      const s0 = boss ? art['pest-boss'] : art[pestNames[p.kind]];
      if (!sprite(s0, frame, p.x, p.y - lift, w, flip, tilt)) { ctx.fillStyle = INK; ctx.beginPath(); ctx.ellipse(p.x, p.y - lift, w * .22, w * .14, 0, 0, 7); ctx.fill(); }
      const hit = hitAt.get(p.id);
      if (hit !== undefined && tick - hit < 6 && !reduced) {
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .55 * (1 - (tick - hit) / 6);
        sprite(s0, frame, p.x, p.y - lift, w, flip, tilt); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
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
      if (p.hp < p.maxHp) {
        const bw = boss ? 96 : 44, by = p.y - lift - w * .5 - (p.carriedTiers.length ? 34 : 0);
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

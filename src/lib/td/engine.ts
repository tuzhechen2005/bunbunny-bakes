import { createRng } from "../game/rng";
import { towerStats, TOWER_KINDS } from "./balance";
import { tdLevelFromSeed } from "./level";
import { distanceSquared, pathLength, pathPosition, pathHeading, pestRoute } from "./maps";
import {
  FIELD_WIDTH, FIELD_HEIGHT, SUBUNITS, type TdCreamLine, type TdItem, type TdPoint,
  BREAD_ROLL_SPEED, type TdDroppedBread,
  MAX_INPUTS, MAX_LEVEL_TICKS, PREP_TICKS, START_BREAD, WAVE_COUNT,
  type TdEvent, type TdGame, type TdInput, type TdOptions, type TdPest,
  type TdBatterPuddle, type TdProjectile, type TdState, type TdTower,
} from "./types";

/** Leave headroom for scheduled combat ticks without imposing a build-phase duration. */
export const validTdTick = (tick: number): boolean => Number.isSafeInteger(tick) && tick >= 0 && tick <= Number.MAX_SAFE_INTEGER - MAX_LEVEL_TICKS;

/** JSON-shaped exact keys; callWave uses slot -1 because it has no build slot. */
export function validTdInput(input: unknown): input is TdInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const i = input as TdInput;
  if (!validTdTick(i.tick)) return false;
  const keys = Object.keys(input).sort().join(",");
  if (i.type === "callWave") return keys === "slot,tick,type" && i.slot === -1;
  if (i.type === "switch") return keys === "fork,tick,type" && Number.isSafeInteger(i.fork) && i.fork >= 0;
  if (i.type === "item") {
    if (i.item === "bell") return keys === "item,tick,type";
    if (i.item === "bomb") return keys === "item,tick,type,x,y" && Number.isInteger(i.x) && Number.isInteger(i.y) && i.x >= 0 && i.x <= FIELD_WIDTH && i.y >= 0 && i.y <= FIELD_HEIGHT;
    return i.item === "slide" && keys === "item,position,tick,type" && Number.isSafeInteger(i.position) && i.position >= 0;
  }
  if (!Number.isInteger(i.slot) || i.slot < 0 || i.slot >= 11) return false;
  if (i.type === "place") return keys === "slot,tick,tower,type" && TOWER_KINDS.includes(i.tower);
  if (i.type === "upgrade") return keys === "slot,tick,type" || (keys === "branch,slot,tick,type" && (i.branch === "a" || i.branch === "b"));
  return i.type === "sell" && keys === "slot,tick,type";
}

export function createTdGame(opts: TdOptions): TdGame {
  if (!opts || (opts.seed === undefined) === (opts.level === undefined)) throw new RangeError("td: supply seed OR level");
  // A descriptor is a convenience, never a trusted source of wave stats or coins.
  const level = tdLevelFromSeed(opts.seed ?? opts.level!.seed);
  const tierCount = opts.tierCount ?? 6;
  if (!Number.isSafeInteger(tierCount) || tierCount < 1 || tierCount > 100) throw new RangeError("td: tierCount must be 1..100");
  const freezeMap = (value: object): void => {
    for (const child of Object.values(value)) if (child && typeof child === 'object') freezeMap(child);
    Object.freeze(value);
  };
  const map = level.mapData, end = pathLength(map);
  freezeMap(map);
  const rng = createRng(`${level.seed}:forks`);
  const switches: Record<number, number> = {};
  for (const f of map.features ?? []) if (f.switchable) switches[f.id] = 0;
  const itemsUsed: Record<TdItem, number> = { bomb: 0, bell: 0, slide: 0 };
  if (opts.itemsAllowed !== undefined && (!opts.itemsAllowed || typeof opts.itemsAllowed !== 'object' || Array.isArray(opts.itemsAllowed))) throw new RangeError('td: invalid inventory');
  const itemsAllowed = { ...opts.itemsAllowed };
  for (const [kind, count] of Object.entries(itemsAllowed)) if (!['bomb','bell','slide'].includes(kind) || !Number.isSafeInteger(count) || count < 0) throw new RangeError('td: invalid inventory');
  let bellUntil = 0, nextLine = 1;
  let creamLines: TdCreamLine[] = [];
  const syncPest = (p: TdPest) => {
    const route = pestRoute(map, p.distance, p.forkChoices);
    Object.assign(p, pathPosition(route.map, route.distance));
    p.heading = pathHeading(route.map, route.distance, p.returning);
    const inside = (type: string) => !!map.features?.some(f => f.type === type && p.distance >= f.start && p.distance < f.end);
    p.inTunnel = inside('tunnel'); p.onStrip = inside('strip'); p.onJam = inside('jam');
  };
  const layLine = (position: number, width: number, until: number, back: number, choices: Record<number, number> = {}, source?: { point: TdPoint; range: number }) => {
    let start = Math.max(0, position-width), finish = Math.min(end,position+width);
    const forkChoices: Record<number,number> = {};
    for (const f of map.features ?? []) if (f.type === 'fork' && position >= f.start && position <= f.end && choices[f.id] !== undefined) forkChoices[f.id] = choices[f.id];
    const geometry: (TdPoint & {distance:number})[] = [];
    for (let d=start;d<=finish;d+=SUBUNITS*5) {
      const route = pestRoute(map,d,choices), point = pathPosition(route.map,route.distance);
      if (!source || distanceSquared(point,source.point) <= source.range**2) geometry.push({...point,distance:d});
    }
    if (!geometry.length) return;
    start = geometry[0].distance; finish = geometry.at(-1)!.distance;
    const points = geometry.map(({x,y})=>({x,y}));
    const fork = map.features?.find(f => f.type === 'fork' && f.start < finish && f.end > start);
    const geometries = fork && forkChoices[fork.id] === undefined ? [0,1].map(branch => geometry.map(p => {
      const route = pestRoute(map,p.distance,{[fork.id]:branch});
      return pathPosition(route.map,route.distance);
    })) : [points];
    creamLines.push({ forkChoices, id:nextLine++,start,end:finish,until,back,geometry:geometries[0],geometries });
  };
  const breadTiers = Array.from({ length: START_BREAD }, (_, i) => Math.floor(i * (tierCount - 1) / (START_BREAD - 1)));
  let tick = 0, coins = level.startCoins, wave = 0, waveTargetTier = breadTiers.at(-1) ?? -1;
  let nextWaveTick: number | null = null;
  let startedTick: number | null = null;
  let spawnIndex = 0, spawnTick: number | null = null;
  let inputsAccepted = 0, inputsRejected = 0, over = false, passed = false;
  let nextPest = 1, nextProjectile = 1;
  let pests: TdPest[] = [], projectiles: TdProjectile[] = [];
  let batterPuddles: TdBatterPuddle[] = [];
  const towers: TdTower[] = [];
  const shotOwners = new Map<number, TdTower>();
  let dropped: TdDroppedBread[] = [], lost = 0, nextBread = 1;
  let events: TdEvent[] = [];

  const finish = (reason: "cleared" | "bread" | "timeout") => {
    over = true; passed = reason === "cleared";
    events.push({ type: "over", tick, passed, reason });
  };
  const startWave = (early: boolean) => {
    const bonus = early && nextWaveTick !== null ? Math.floor((nextWaveTick - tick) / 60) * 3 : 0;
    if (startedTick === null) startedTick = tick;
    coins += bonus;
    wave++;
    waveTargetTier = breadTiers.at(-1) ?? -1;
    spawnIndex = 0; spawnTick = tick + 1; nextWaveTick = null;
    events.push({ type: "waveStart", tick, wave, targetTier: waveTargetTier, bonus });
  };
  let sifters: { tower: TdTower; stats: ReturnType<typeof towerStats> }[] = [];
  const aura = (pest: TdPest) => {
    let slow = 0;
    pest.floured = false; pest.vulnerability = 0;
    for (const { tower, stats } of sifters) if (distanceSquared(pest, tower) <= stats.range ** 2) {
      pest.floured = true;
      slow = Math.max(slow, stats.slowPercent);
      pest.vulnerability = Math.max(pest.vulnerability, stats.vulnerability);
    }
    const lingering = Math.floor(pest.slowStrength * Math.max(0,pest.slowUntil-tick) / 90);
    if (slow && slow >= lingering) { pest.slowUntil = tick + 90; pest.slowStrength = slow; }
    slow = Math.max(slow,lingering);
    if (pest.kind !== "sparrow" || pest.floured) for (const puddle of batterPuddles) {
      if (distanceSquared(pest, puddle) <= puddle.radius ** 2) slow = Math.max(slow, 30);
    }
    pest.slowed = slow > 0;
    return slow;
  };
  const hit = (pest: TdPest, shot: Pick<TdProjectile, "id" | "slot" | "damage" | "knockback" | "burn">) => {
    if (pest.hp <= 0) return;
    const tower = shotOwners.get(shot.id);
    if (shot.id && tower?.kind === "rollingPin") {
      tower.hitCount++;
      if (tower.hitCount % 3 === 0) pest.stunnedUntil = tick + 24;
    }
    // Vulnerability applies after armor, including burn ticks; never stacks.
    const damage = Math.min(pest.hp, Math.floor(Math.max(1, shot.damage - pest.armor) * (100 + pest.vulnerability) / 100));
    if (shot.burn) {
      pest.burnUntil = tick + 180;
      if (!pest.burning) pest.burnTick = tick + 30;
      pest.burnDamage = Math.max(pest.burning ? pest.burnDamage : 0, shot.burn);
      pest.burnTower = shot.slot; pest.burning = true;
    }
    pest.hp -= damage;
    events.push({ type: "hit", tick, projectile: shot.id, pest: pest.id, tower: shot.slot, damage });
    if (pest.hp === 0) {
      if (pest.burning) {
        const neighbor = pests.filter(p => p.id !== pest.id && p.hp > 0 && distanceSquared(p, pest) <= 120 ** 2)
          .sort((a, b) => distanceSquared(a, pest) - distanceSquared(b, pest) || a.id - b.id)[0];
        if (neighbor) {
          neighbor.burnDamage = Math.max(neighbor.burning ? neighbor.burnDamage : 0, pest.burnDamage);
          neighbor.burnUntil = tick + 180;
          if (!neighbor.burning) neighbor.burnTick = tick + 30;
          neighbor.burnTower = pest.burnTower; neighbor.burning = true;
        }
      }
      coins += pest.bounty;
      if (pest.carrying) {
        events.push({ type: "drop", tick, pest: pest.id, tiers: [...pest.carriedTiers], x: pest.x, y: pest.y });
        for (const tier of pest.carriedTiers) dropped.push({ forkChoices:{...pest.forkChoices}, id: nextBread++, tier, distance: pest.distance, x: pest.x, y: pest.y });
        pest.carriedTiers = []; pest.carrying = 0;
      }
      events.push({ type: "kill", tick, pest: pest.id, bounty: pest.bounty, x: pest.x, y: pest.y });
    } else {
      if (shot.knockback) {
        pest.distance = Math.max(0, Math.min(end, pest.distance + (pest.returning ? 1 : -1) * shot.knockback));
        syncPest(pest);
        aura(pest);
      }
    }
  };
  const advance = (toTick: number) => {
    // No simulation runs during the unlimited build phase, even for huge replay gaps.
    if (startedTick === null) { tick = toTick; return; }
    // Inputs cannot change towers during an advance; reuse their stats across ticks.
    const combat = towers.map(tower => ({ tower, stats: towerStats(tower.kind, tower.level, tower.branch) }));
    sifters = combat.filter(({ tower }) => tower.kind === "flourSifter");
    while (!over && tick < toTick) {
      tick++;
      // Timeout wins all ties; spawn exits resolve before damage.
      if (tick - startedTick === MAX_LEVEL_TICKS) { finish("timeout"); break; }
      if (nextWaveTick !== null && tick >= nextWaveTick) startWave(false);
      if (spawnTick !== null && tick >= spawnTick) {
        const spec = level.waves[wave - 1].pests[spawnIndex++];
        const pest: TdPest = { ...spec, ...pathPosition(map, 0), inTunnel:false, onStrip:false, onJam:false, forkChoices:{}, slipped:[], slowUntil:0, slowStrength:0, id: nextPest++, wave, distance: 0, maxHp: spec.hp, slowed: false, heading: pathHeading(map, 0), carrying: 0, carriedTiers: [], returning: false, frozenUntil: bellUntil, stunnedUntil: 0, floured: false, burning: false, vulnerability: 0, burnUntil: 0, burnTick: 0, burnDamage: 0, burnTower: -1 };
        syncPest(pest);
        pests.push(pest);
        if (pest.boss) events.push({ type: "bossSpawn", tick, pest: pest.id, wave });
        events.push({ type: "spawn", tick, pest: pest.id, kind: pest.kind, wave });
        if (spawnIndex === level.waves[wave - 1].pests.length) {
          spawnTick = null;
          if (wave < WAVE_COUNT) nextWaveTick = tick + PREP_TICKS;
        } else spawnTick = tick + level.waves[wave - 1].interval;
      }

      for (const bread of dropped) {
        bread.distance = Math.min(end, bread.distance + BREAD_ROLL_SPEED);
        const route = pestRoute(map,bread.distance,bread.forkChoices);
        Object.assign(bread, pathPosition(route.map, route.distance));
        if (bread.distance === end) {
          breadTiers.push(bread.tier); breadTiers.sort((a, b) => a - b);
          events.push({ type: "recover", tick, bread: bread.id, tier: bread.tier, x: bread.x, y: bread.y });
        }
      }
      dropped = dropped.filter(b => b.distance < end);
      creamLines = creamLines.filter(line => line.until > tick);
      batterPuddles = batterPuddles.filter(p => p.until > tick);
      for (const pest of pests) {
        const slow = aura(pest);
        pest.burning = pest.burnUntil >= tick && pest.burnDamage > 0;
        // Grounded birds use the mouse species speed ratio before slowing.
        const baseSpeed = pest.kind === "sparrow" && pest.floured ? Math.floor(pest.speed * 34 / 56) : pest.speed;
        const route = pestRoute(map, pest.distance, pest.forkChoices);
        const speed = pest.stunnedUntil > tick || pest.frozenUntil > tick ? 0 : Math.max(1, Math.floor(baseSpeed * (100 - slow) * (pest.carrying ? 80 : 100) * (pest.onStrip ? 160 : pest.onJam ? 60 : 100) * route.scale / 1000000000));
        const previous = pest.distance;
        pest.distance = Math.max(0, Math.min(end, pest.distance + (pest.returning ? -speed : speed)));
        let traversed = pest.distance, teleported = false;
        for (const feature of map.features ?? []) {
          if (feature.type === 'fork' && pest.forkChoices[feature.id] === undefined && previous < feature.start && pest.distance >= feature.start) pest.forkChoices[feature.id] = feature.switchable ? switches[feature.id] : rng.int(2);
          if (feature.type === 'portal') {
            if (!pest.returning && previous < feature.start && pest.distance >= feature.start) { traversed = feature.start; pest.distance = feature.end; teleported = true; }
            if (pest.returning && previous > feature.end && pest.distance <= feature.end) { traversed = feature.end; pest.distance = feature.start; teleported = true; }
          }
        }
        for (const line of creamLines) if (previous !== pest.distance && !pest.slipped.includes(line.id) && Object.entries(line.forkChoices).every(([id,branch]) => pest.forkChoices[Number(id)] === branch) && ((Math.max(previous,traversed) >= line.start && Math.min(previous,traversed) <= line.end) || (teleported && pest.distance >= line.start && pest.distance <= line.end))) {
          pest.slipped.push(line.id);
          // A line crossed before the portal interrupts entry rather than firing at the exit.
          if (teleported && Math.max(previous,traversed) >= line.start && Math.min(previous,traversed) <= line.end) pest.distance = traversed;
          pest.distance = Math.max(0,Math.min(end,pest.distance+(pest.returning?1:-1)*line.back));
          break;
        }
        syncPest(pest);
        if (!pest.returning && pest.distance === end) {
          pest.returning = true;
          pest.carriedTiers = breadTiers.splice(Math.max(0, breadTiers.length - (pest.boss ? 3 : 1))).reverse();
          pest.carrying = pest.carriedTiers.length;
          if (pest.carrying) events.push({ type: "pickup", tick, pest: pest.id, tiers: [...pest.carriedTiers], x: pest.x, y: pest.y });
        } else if (pest.returning && pest.distance === 0) {
          lost += pest.carrying;
          if (pest.carrying) events.push({ type: "lose", tick, pest: pest.id, tiers: [...pest.carriedTiers], x: pest.x, y: pest.y });
          pest.carrying = 0; pest.carriedTiers = [];
        }
        syncPest(pest);
      }
      pests = pests.filter(p => !(p.returning && p.distance === 0));
      if (lost === START_BREAD) { finish("bread"); break; }
      // Damage and snapshots use membership at the resulting position.
      for (const pest of pests) aura(pest);
      for (const pest of pests) if (pest.burnUntil >= tick && pest.burnDamage && tick >= pest.burnTick) {
        hit(pest, { id: 0, slot: pest.burnTower, damage: pest.burnDamage, knockback: 0, burn: 0 });
        pest.burnTick = tick + 30;
      }

      for (const shot of projectiles) {
        const target = pests.find(p => p.id === shot.target && p.hp > 0 && !p.inTunnel);
        if (target) { shot.targetX = target.x; shot.targetY = target.y; }
        const age = tick - shot.bornTick, flight = shot.hitTick - shot.bornTick;
        shot.x = shot.fromX + Math.trunc((shot.targetX - shot.fromX) * age / flight);
        shot.y = shot.fromY + Math.trunc((shot.targetY - shot.fromY) * age / flight);
        if (tick >= shot.hitTick) {
          if (shot.splash) {
            batterPuddles.push({ x: shot.targetX, y: shot.targetY, radius: shot.splash, until: tick + 120 });
            for (const pest of pests) if (!pest.inTunnel && (pest.kind !== "sparrow" || pest.floured) && distanceSquared(pest, { x: shot.targetX, y: shot.targetY }) <= shot.splash ** 2) hit(pest, shot);
          } else if (target) {
            for (let strike = 0; strike < shot.strikes; strike++) hit(target, shot);
            if (shot.pierce) {
              // Continue the projectile through a narrow corridor beyond its target.
              const dx = target.x - shot.fromX, dy = target.y - shot.fromY;
              const length2 = dx * dx + dy * dy;
              const projection = (p: TdPest) => (p.x - target.x) * dx + (p.y - target.y) * dy;
              const others = pests.filter(p => {
                const cross = (p.x - target.x) * dy - (p.y - target.y) * dx;
                return !p.inTunnel && p.id !== target.id && p.hp > 0 && length2 > 0 && projection(p) >= 0
                  && cross * cross <= 40 ** 2 * length2 && distanceSquared(p, target) <= 150 ** 2;
              }).sort((a, b) => projection(a) - projection(b) || a.id - b.id);
              for (const pest of others.slice(0, shot.pierce)) hit(pest, shot);
            }
          }
        }
      }
      for (const shot of projectiles) if (shot.hitTick <= tick) shotOwners.delete(shot.id);
      projectiles = projectiles.filter(p => p.hitTick > tick);
      pests = pests.filter(p => p.hp > 0);

      // Stable slot order, then furthest path progress, then oldest pest id.
      for (const { tower, stats } of combat) {
        if (tower.kind === "flourSifter" || tower.readyTick > tick) continue;
        let target: TdPest | undefined;
        for (const pest of pests) if (pest.hp > 0 && !pest.inTunnel && (tower.kind !== "whisk" || pest.kind !== "sparrow" || pest.floured) && distanceSquared(tower, pest) <= stats.range ** 2
          && (!target || pest.distance > target.distance || (pest.distance === target.distance && pest.id < target.id))) target = pest;
        tower.target = target?.id ?? null;
        if (!target) continue;
        if (tower.kind === 'freezer' || tower.kind === 'pipingBag' || tower.kind === 'caramelTorch') {
          tower.lastAttackTick = tick; tower.readyTick = tick + stats.cooldown;
          if (tower.kind === 'freezer') for (const p of pests) {
            if (!p.inTunnel && distanceSquared(tower,p) <= stats.range ** 2) p.frozenUntil = Math.max(p.frozenUntil,tick+60);
          }
          if (tower.kind === 'pipingBag') layLine(target.distance, 35*SUBUNITS, tick+180, stats.knockback || 50*SUBUNITS, target.forkChoices, {point:tower,range:stats.range});
          if (tower.kind === 'caramelTorch') {
            const dx = target.x-tower.x, dy = target.y-tower.y, axis = dx*dx+dy*dy;
            for (const p of pests) {
              const px = p.x-tower.x, py = p.y-tower.y, dot = px*dx+py*dy;
              if (!p.inTunnel && dot >= 0 && dot*dot*4 >= (px*px+py*py)*axis*3 && distanceSquared(tower,p) <= stats.range ** 2) hit(p,{id:0,slot:tower.slot,damage:stats.damage,knockback:0,burn:0});
            }
          }
          continue;
        }
        const shot: TdProjectile = {
          id: nextProjectile++, kind: tower.kind, slot: tower.slot, target: target.id,
          x: tower.x, y: tower.y, fromX: tower.x, fromY: tower.y, targetX: target.x, targetY: target.y,
          bornTick: tick, hitTick: tick + stats.flight, damage: stats.damage, splash: stats.splash, strikes: stats.strikes, knockback: stats.knockback, burn: stats.burn, pierce: stats.pierce,
        };
        tower.target = target.id; tower.lastAttackTick = tick;
        shotOwners.set(shot.id, tower);
        projectiles.push(shot); tower.readyTick = tick + stats.cooldown;
        events.push({ type: "shot", tick, projectile: shot.id, slot: tower.slot, target: target.id });
      }
      pests = pests.filter(p => p.hp > 0);
      if (wave === WAVE_COUNT && spawnTick === null && !pests.length) finish("cleared");
    }
  };
  const cloneEvents = () => events.map(e => ("tiers" in e ? { ...e, tiers: [...e.tiers] } : { ...e }));
  const state = (): TdState => ({
    mapData: map, unlockedTowers:[...level.unlockedTowers], newlyUnlocked:[...level.newlyUnlocked],
    itemsUsed:{...itemsUsed}, switches:{...switches}, creamLines:structuredClone(creamLines),
    tick, seed: level.seed, level: level.number, map: level.map, coins,
    bread: START_BREAD - lost, breadTiers: [...breadTiers], wave, waveTargetTier,
    nextWave: !over && wave < WAVE_COUNT ? { index: wave + 1, counts: level.waves[wave].pests.reduce((counts, pest) => {
      counts[pest.boss ? "boss" : pest.kind]++; return counts;
    }, { ant: 0, mouse: 0, sparrow: 0, beetle: 0, boss: 0 }) } : null,
    dropped: dropped.map(b => ({ ...b, forkChoices:{...b.forkChoices} })), lost,
    awaitingStart: startedTick === null, startedTick, nextWaveTick, spawning: spawnTick !== null, over, passed, inputsAccepted, inputsRejected,
    pests: pests.map(p => ({ ...p, forkChoices:{...p.forkChoices}, slipped:[...p.slipped], carriedTiers: [...p.carriedTiers] })), towers: towers.map(t => ({ ...t,
      target: pests.some(p => p.id === t.target) ? t.target : null,
      cooldownProgress: t.lastAttackTick === null ? 100 : Math.min(100, Math.floor((tick - t.lastAttackTick) * 100 / Math.max(1, t.readyTick - t.lastAttackTick))),
    })),
    batterPuddles: batterPuddles.map(p => ({ ...p })),
    projectiles: projectiles.map(p => ({ ...p })), events: cloneEvents(),
  });
  return {
    state,
    step(toTick) {
      if (!validTdTick(toTick) || toTick < tick) throw new RangeError("td: step needs a nondecreasing safe tick");
      events = []; advance(toTick); return cloneEvents();
    },
    apply(input) {
      events = [];
      const reject = () => { inputsRejected++; return false; };
      if (!validTdInput(input) || input.tick < tick || inputsAccepted + inputsRejected >= MAX_INPUTS) return reject();
      advance(input.tick);
      if (over) return reject();
      if (input.type === "callWave") {
        if (startedTick !== null && nextWaveTick === null) return reject();
        startWave(true);
      } else if (input.type === 'switch') {
        if (!(input.fork in switches)) return reject();
        switches[input.fork] = 1-switches[input.fork];
      } else if (input.type === 'item') {
        if (level.number < {bomb:2,bell:6,slide:10}[input.item] || !itemsAllowed[input.item] || itemsUsed[input.item]) return reject();
        if (input.item === 'slide' && input.position > end) return reject();
        itemsUsed[input.item]++;
        if (input.item === 'bell') {
          bellUntil = tick+180;
          for (const p of pests) p.frozenUntil = Math.max(p.frozenUntil,bellUntil);
        }
        if (input.item === 'bomb') {
          for (const p of pests) if (distanceSquared(p,input) <= 180**2) hit(p,{id:0,slot:-1,damage:400,knockback:0,burn:0});
          pests = pests.filter(p => p.hp > 0);
        }
        if (input.item === 'slide') layLine(input.position, 20*SUBUNITS, Number.MAX_SAFE_INTEGER, 120*SUBUNITS);
      } else {
        if (input.slot >= map.slots.length) return reject();
        const tower = towers.find(t => t.slot === input.slot);
        if (input.type === "place") {
          const cost = towerStats(input.tower).cost;
          if (!level.unlockedTowers.includes(input.tower) || tower || coins < cost) return reject();
          coins -= cost;
          towers.push({ ...map.slots[input.slot], slot: input.slot, kind: input.tower, level: 0, spent: cost, readyTick: tick + 1, tier: 0, branch: null, target: null, cooldownProgress: 100, lastAttackTick: null, hitCount: 0 });
          towers.sort((a, b) => a.slot - b.slot);
          events.push({ type: "place", tick, slot: input.slot, tower: input.tower, tier: 0, branch: null });
        } else if (input.type === "upgrade") {
          if (!tower || tower.level === 2 || (tower.level === 1 ? !input.branch : input.branch !== undefined)) return reject();
          const cost = towerStats(tower.kind, tower.level + 1).cost;
          if (coins < cost) return reject();
          coins -= cost; tower.spent += cost; tower.level++; tower.tier = tower.level; tower.branch = input.branch ?? null;
          // Retain cooldown: upgrading cannot manufacture an immediate extra shot.
          events.push({ type: "upgrade", tick, slot: input.slot, tower: tower.kind, tier: tower.tier, branch: tower.branch });
        } else {
          if (!tower) return reject();
          const refund = Math.floor(tower.spent / 2);
          coins += refund; towers.splice(towers.indexOf(tower), 1);
          events.push({ type: "sell", tick, slot: input.slot, refund });
        }
      }
      inputsAccepted++; return true;
    },
    get over() { return over; },
    get passed() { return passed; },
    get inputsAccepted() { return inputsAccepted; },
    get inputsRejected() { return inputsRejected; },
  };
}

/** Count accepted item actions only; callers must verify replay/rejection counts first. */
export function countItemUses(inputs: readonly TdInput[]): Record<TdItem, number> {
  const uses = {bomb:0,bell:0,slide:0};
  for (const input of inputs) if (validTdInput(input) && input.type === 'item') uses[input.item]++;
  return uses;
}

import { towerStats, TOWER_KINDS } from "./balance";
import { tdLevelFromSeed } from "./level";
import { distanceSquared, pathLength, pathPosition, TD_MAPS } from "./maps";
import {
  MAX_INPUTS, MAX_LEVEL_TICKS, PREP_TICKS, START_BREAD, WAVE_COUNT,
  type TdEvent, type TdGame, type TdInput, type TdOptions, type TdPest,
  type TdProjectile, type TdState, type TdTower,
} from "./types";

export const validTdTick = (tick: number): boolean => Number.isSafeInteger(tick) && tick >= 0 && tick <= MAX_LEVEL_TICKS;

/** JSON-shaped exact keys; callWave uses slot -1 because it has no build slot. */
export function validTdInput(input: unknown): input is TdInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const i = input as TdInput;
  if (!validTdTick(i.tick)) return false;
  const keys = Object.keys(input).sort().join(",");
  if (i.type === "callWave") return keys === "slot,tick,type" && i.slot === -1;
  if (!Number.isInteger(i.slot) || i.slot < 0 || i.slot >= 10) return false;
  if (i.type === "place") return keys === "slot,tick,tower,type" && TOWER_KINDS.includes(i.tower);
  return (i.type === "upgrade" || i.type === "sell") && keys === "slot,tick,type";
}

export function createTdGame(opts: TdOptions): TdGame {
  if (!opts || (opts.seed === undefined) === (opts.level === undefined)) throw new RangeError("td: supply seed OR level");
  // A descriptor is a convenience, never a trusted source of wave stats or coins.
  const level = tdLevelFromSeed(opts.seed ?? opts.level!.seed);
  const tierCount = opts.tierCount ?? 6;
  if (!Number.isSafeInteger(tierCount) || tierCount < 1 || tierCount > 100) throw new RangeError("td: tierCount must be 1..100");
  const map = TD_MAPS[level.map], end = pathLength(map);
  const breadTiers = Array.from({ length: START_BREAD }, (_, i) => Math.floor(i * (tierCount - 1) / (START_BREAD - 1)));
  let tick = 0, coins = level.startCoins, wave = 0, waveTargetTier = breadTiers[0];
  let nextWaveTick: number | null = PREP_TICKS;
  let spawnIndex = 0, spawnTick: number | null = null;
  let inputsAccepted = 0, inputsRejected = 0, over = false, passed = false;
  let nextPest = 1, nextProjectile = 1;
  let pests: TdPest[] = [], projectiles: TdProjectile[] = [];
  const towers: TdTower[] = [];
  let events: TdEvent[] = [];

  const finish = (reason: "cleared" | "bread" | "timeout") => {
    over = true; passed = reason === "cleared";
    events.push({ type: "over", tick, passed, reason });
  };
  const startWave = (early: boolean) => {
    const bonus = early ? Math.floor((nextWaveTick! - tick) / 60) * 3 : 0;
    coins += bonus;
    wave++;
    waveTargetTier = breadTiers[0];
    spawnIndex = 0; spawnTick = tick + 1; nextWaveTick = null;
    events.push({ type: "wave", tick, wave, targetTier: waveTargetTier, bonus });
  };
  const hit = (pest: TdPest, shot: TdProjectile) => {
    if (pest.hp <= 0) return;
    const damage = Math.min(pest.hp, Math.max(1, shot.damage - pest.armor));
    pest.hp -= damage;
    events.push({ type: "hit", tick, projectile: shot.id, pest: pest.id, damage });
    if (pest.hp === 0) {
      coins += pest.bounty;
      events.push({ type: "kill", tick, pest: pest.id, bounty: pest.bounty });
    }
  };
  const advance = (toTick: number) => {
    while (!over && tick < toTick) {
      tick++;
      // Timeout and endpoint theft win ties against spawning and projectile impacts.
      if (tick === MAX_LEVEL_TICKS) { finish("timeout"); break; }
      if (nextWaveTick !== null && tick >= nextWaveTick) startWave(false);
      if (spawnTick !== null && tick >= spawnTick) {
        const spec = level.waves[wave - 1].pests[spawnIndex++];
        const pest: TdPest = { ...spec, ...pathPosition(map, 0), id: nextPest++, wave, distance: 0, maxHp: spec.hp, slowed: false };
        pests.push(pest);
        events.push({ type: "spawn", tick, pest: pest.id, kind: pest.kind, wave });
        if (spawnIndex === level.waves[wave - 1].pests.length) {
          spawnTick = null;
          if (wave < WAVE_COUNT) nextWaveTick = tick + PREP_TICKS;
        } else spawnTick = tick + level.waves[wave - 1].interval;
      }

      const sifters = towers.filter(t => t.kind === "flourSifter").map(t => ({ tower: t, stats: towerStats(t.kind, t.level) }));
      for (const pest of pests) {
        let slow = 0;
        if (pest.kind !== "sparrow") for (const { tower, stats } of sifters) {
          if (distanceSquared(pest, tower) <= stats.range ** 2) slow = Math.max(slow, stats.slowPercent);
        }
        pest.slowed = slow > 0;
        pest.distance += Math.max(1, Math.floor(pest.speed * (100 - slow) / 100));
        Object.assign(pest, pathPosition(map, pest.distance));
        if (pest.distance >= end) {
          const tier = breadTiers.shift()!;
          events.push({ type: "steal", tick, pest: pest.id, tier });
          if (!breadTiers.length) { finish("bread"); break; }
        }
      }
      pests = pests.filter(p => p.distance < end);
      if (over) break;

      for (const shot of projectiles) {
        const target = pests.find(p => p.id === shot.target && p.hp > 0);
        if (target) { shot.targetX = target.x; shot.targetY = target.y; }
        const age = tick - shot.bornTick, flight = shot.hitTick - shot.bornTick;
        shot.x = shot.fromX + Math.trunc((shot.targetX - shot.fromX) * age / flight);
        shot.y = shot.fromY + Math.trunc((shot.targetY - shot.fromY) * age / flight);
        if (tick >= shot.hitTick) {
          if (shot.splash) {
            for (const pest of pests) if (distanceSquared(pest, { x: shot.targetX, y: shot.targetY }) <= shot.splash ** 2) hit(pest, shot);
          } else if (target) hit(target, shot);
        }
      }
      projectiles = projectiles.filter(p => p.hitTick > tick);
      pests = pests.filter(p => p.hp > 0);

      // Stable slot order, then furthest path progress, then oldest pest id.
      for (const tower of towers) {
        if (tower.kind === "flourSifter" || tower.readyTick > tick) continue;
        const stats = towerStats(tower.kind, tower.level);
        let target: TdPest | undefined;
        for (const pest of pests) if (distanceSquared(tower, pest) <= stats.range ** 2
          && (!target || pest.distance > target.distance || (pest.distance === target.distance && pest.id < target.id))) target = pest;
        if (!target) continue;
        const shot: TdProjectile = {
          id: nextProjectile++, kind: tower.kind, slot: tower.slot, target: target.id,
          x: tower.x, y: tower.y, fromX: tower.x, fromY: tower.y, targetX: target.x, targetY: target.y,
          bornTick: tick, hitTick: tick + stats.flight, damage: stats.damage, splash: stats.splash,
        };
        projectiles.push(shot); tower.readyTick = tick + stats.cooldown;
        events.push({ type: "shot", tick, projectile: shot.id, slot: tower.slot, target: target.id });
      }
      if (wave === WAVE_COUNT && spawnTick === null && !pests.length) finish("cleared");
    }
  };
  const cloneEvents = () => events.map(e => ({ ...e }));
  const state = (): TdState => ({
    tick, seed: level.seed, level: level.number, map: level.map, coins,
    bread: breadTiers.length, breadTiers: [...breadTiers], wave, waveTargetTier,
    nextWaveTick, spawning: spawnTick !== null, over, passed, inputsAccepted, inputsRejected,
    pests: pests.map(p => ({ ...p })), towers: towers.map(t => ({ ...t })),
    projectiles: projectiles.map(p => ({ ...p })), events: cloneEvents(),
  });
  return {
    state,
    step(toTick) {
      if (!validTdTick(toTick) || toTick < tick) throw new RangeError("td: step needs a nondecreasing tick within the level cap");
      events = []; advance(toTick); return cloneEvents();
    },
    apply(input) {
      events = [];
      const reject = () => { inputsRejected++; return false; };
      if (!validTdInput(input) || input.tick < tick || inputsAccepted + inputsRejected >= MAX_INPUTS) return reject();
      advance(input.tick);
      if (over) return reject();
      if (input.type === "callWave") {
        if (nextWaveTick === null) return reject();
        startWave(true);
      } else {
        const tower = towers.find(t => t.slot === input.slot);
        if (input.type === "place") {
          const cost = towerStats(input.tower).cost;
          if (tower || coins < cost) return reject();
          coins -= cost;
          towers.push({ ...map.slots[input.slot], slot: input.slot, kind: input.tower, level: 0, spent: cost, readyTick: tick + 1 });
          towers.sort((a, b) => a.slot - b.slot);
          events.push({ type: "build", tick, slot: input.slot, tower: input.tower, level: 0 });
        } else if (input.type === "upgrade") {
          if (!tower || tower.level === 2) return reject();
          const cost = towerStats(tower.kind, tower.level + 1).cost;
          if (coins < cost) return reject();
          coins -= cost; tower.spent += cost; tower.level++;
          // Retain cooldown: upgrading cannot manufacture an immediate extra shot.
          events.push({ type: "build", tick, slot: input.slot, tower: tower.kind, level: tower.level });
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

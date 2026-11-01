import { towerStats, TOWER_KINDS } from "./balance";
import { tdLevelFromSeed } from "./level";
import { distanceSquared, pathLength, pathPosition, pathHeading, TD_MAPS } from "./maps";
import {
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
  if (!Number.isInteger(i.slot) || i.slot < 0 || i.slot >= TD_MAPS[0].slots.length) return false;
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
  const map = TD_MAPS[level.map], end = pathLength(map);
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
        for (const tier of pest.carriedTiers) dropped.push({ id: nextBread++, tier, distance: pest.distance, x: pest.x, y: pest.y });
        pest.carriedTiers = []; pest.carrying = 0;
      }
      events.push({ type: "kill", tick, pest: pest.id, bounty: pest.bounty, x: pest.x, y: pest.y });
    } else {
      if (shot.knockback) {
        pest.distance = Math.max(0, Math.min(end, pest.distance + (pest.returning ? 1 : -1) * shot.knockback));
        Object.assign(pest, pathPosition(map, pest.distance));
        pest.heading = pathHeading(map, pest.distance, pest.returning);
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
        const pest: TdPest = { ...spec, ...pathPosition(map, 0), id: nextPest++, wave, distance: 0, maxHp: spec.hp, slowed: false, heading: pathHeading(map, 0), carrying: 0, carriedTiers: [], returning: false, stunnedUntil: 0, floured: false, burning: false, vulnerability: 0, burnUntil: 0, burnTick: 0, burnDamage: 0, burnTower: -1 };
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
        Object.assign(bread, pathPosition(map, bread.distance));
        if (bread.distance === end) {
          breadTiers.push(bread.tier); breadTiers.sort((a, b) => a - b);
          events.push({ type: "recover", tick, bread: bread.id, tier: bread.tier, x: bread.x, y: bread.y });
        }
      }
      dropped = dropped.filter(b => b.distance < end);
      batterPuddles = batterPuddles.filter(p => p.until > tick);
      for (const pest of pests) {
        const slow = aura(pest);
        pest.burning = pest.burnUntil >= tick && pest.burnDamage > 0;
        // Grounded birds use the mouse species speed ratio before slowing.
        const baseSpeed = pest.kind === "sparrow" && pest.floured ? Math.floor(pest.speed * 34 / 56) : pest.speed;
        const speed = pest.stunnedUntil > tick ? 0 : Math.max(1, Math.floor(baseSpeed * (100 - slow) * (pest.carrying ? 80 : 100) / 10000));
        pest.distance = Math.max(0, Math.min(end, pest.distance + (pest.returning ? -speed : speed)));
        Object.assign(pest, pathPosition(map, pest.distance));
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
        pest.heading = pathHeading(map, pest.distance, pest.returning);
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
        const target = pests.find(p => p.id === shot.target && p.hp > 0);
        if (target) { shot.targetX = target.x; shot.targetY = target.y; }
        const age = tick - shot.bornTick, flight = shot.hitTick - shot.bornTick;
        shot.x = shot.fromX + Math.trunc((shot.targetX - shot.fromX) * age / flight);
        shot.y = shot.fromY + Math.trunc((shot.targetY - shot.fromY) * age / flight);
        if (tick >= shot.hitTick) {
          if (shot.splash) {
            batterPuddles.push({ x: shot.targetX, y: shot.targetY, radius: shot.splash, until: tick + 120 });
            for (const pest of pests) if ((pest.kind !== "sparrow" || pest.floured) && distanceSquared(pest, { x: shot.targetX, y: shot.targetY }) <= shot.splash ** 2) hit(pest, shot);
          } else if (target) {
            for (let strike = 0; strike < shot.strikes; strike++) hit(target, shot);
            if (shot.pierce) {
              // Continue the projectile through a narrow corridor beyond its target.
              const dx = target.x - shot.fromX, dy = target.y - shot.fromY;
              const length2 = dx * dx + dy * dy;
              const projection = (p: TdPest) => (p.x - target.x) * dx + (p.y - target.y) * dy;
              const others = pests.filter(p => {
                const cross = (p.x - target.x) * dy - (p.y - target.y) * dx;
                return p.id !== target.id && p.hp > 0 && length2 > 0 && projection(p) >= 0
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
        for (const pest of pests) if ((tower.kind !== "whisk" || pest.kind !== "sparrow" || pest.floured) && distanceSquared(tower, pest) <= stats.range ** 2
          && (!target || pest.distance > target.distance || (pest.distance === target.distance && pest.id < target.id))) target = pest;
        tower.target = target?.id ?? null;
        if (!target) continue;
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
      if (wave === WAVE_COUNT && spawnTick === null && !pests.length) finish("cleared");
    }
  };
  const cloneEvents = () => events.map(e => ("tiers" in e ? { ...e, tiers: [...e.tiers] } : { ...e }));
  const state = (): TdState => ({
    tick, seed: level.seed, level: level.number, map: level.map, coins,
    bread: START_BREAD - lost, breadTiers: [...breadTiers], wave, waveTargetTier,
    nextWave: !over && wave < WAVE_COUNT ? { index: wave + 1, counts: level.waves[wave].pests.reduce((counts, pest) => {
      counts[pest.boss ? "boss" : pest.kind]++; return counts;
    }, { ant: 0, mouse: 0, sparrow: 0, beetle: 0, boss: 0 }) } : null,
    dropped: dropped.map(b => ({ ...b })), lost,
    awaitingStart: startedTick === null, startedTick, nextWaveTick, spawning: spawnTick !== null, over, passed, inputsAccepted, inputsRejected,
    pests: pests.map(p => ({ ...p, carriedTiers: [...p.carriedTiers] })), towers: towers.map(t => ({ ...t,
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
      } else {
        const tower = towers.find(t => t.slot === input.slot);
        if (input.type === "place") {
          const cost = towerStats(input.tower).cost;
          if (tower || coins < cost) return reject();
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

export const TD_ENGINE_VERSION = 8;
export const TICKS_PER_SECOND = 60;
export const FIELD_WIDTH = 1440;
export const FIELD_HEIGHT = 810;
/** Movement uses sixteenths of a field unit; drawing coordinates are integer field units. */
export const SUBUNITS = 16;
export const MAX_LEVEL_TICKS = 60 * 60 * 5;
export const MAX_INPUTS = 2000;
export const MAX_IGNORED_INPUTS = 120;
export const START_BREAD = 10;
export const WAVE_COUNT = 5;
export const PREP_TICKS = 600;
export const BREAD_ROLL_SPEED = 64;
/** A 21 CSS-pixel radius on a 720-pixel-wide landscape board. */
export const TD_SLOT_RADIUS = 42;
export type TdBranch = "a" | "b";

export interface TdPoint { x: number; y: number }
export interface TdMap { name: string; path: readonly Readonly<TdPoint>[]; slots: readonly Readonly<TdPoint>[] }
export type PestKind = "ant" | "mouse" | "sparrow" | "beetle";
export type TowerKind = "rollingPin" | "flourSifter" | "whisk" | "oven";
export interface TdPestSpec { kind: PestKind; hp: number; speed: number; bounty: number; armor: number; boss?: boolean }
export interface TdWave { pests: TdPestSpec[]; interval: number }
export interface TdLevel { seed: string; weekKey: string; number: number; map: number; startCoins: number; waves: TdWave[] }
export type TdOptions = ({ seed: string; level?: never } | { level: TdLevel; seed?: never }) & {
  /** Owner's tiers ordered cheapest first. Only their count/indices enter simulation. */
  tierCount?: number;
};
export type TdInput =
  | { tick: number; type: "place"; slot: number; tower: TowerKind }
  | { tick: number; type: "upgrade"; slot: number; branch?: TdBranch }
  | { tick: number; type: "sell"; slot: number }
  | { tick: number; type: "callWave"; slot: -1 };
export interface TdPest extends TdPestSpec, TdPoint {
  id: number; wave: number; distance: number; maxHp: number; slowed: boolean; heading: number; carrying: number; carriedTiers: number[]; returning: boolean;
  stunnedUntil: number; floured: boolean; burning: boolean; vulnerability: number;
  burnUntil: number; burnTick: number; burnDamage: number; burnTower: number;
}
export interface TdTower extends TdPoint {
  hitCount: number;
  slot: number; kind: TowerKind; level: number; spent: number; readyTick: number; tier: number; branch: TdBranch | null; target: number | null; cooldownProgress: number; lastAttackTick: number | null;
}
export interface TdProjectile extends TdPoint {
  id: number; kind: TowerKind; slot: number; target: number;
  fromX: number; fromY: number; targetX: number; targetY: number;
  bornTick: number; hitTick: number; damage: number; splash: number; strikes: number; knockback: number; burn: number; pierce: number;
}
export interface TdBatterPuddle extends TdPoint { radius: number; until: number }
export interface TdDroppedBread extends TdPoint { id: number; distance: number; tier: number }
export interface TdWavePreview { index: number; counts: Record<PestKind | "boss", number> }
export type TdEvent =
  | { [K in "pickup" | "drop" | "lose"]: { type: K; tick: number; pest: number; tiers: number[]; x: number; y: number } }["pickup" | "drop" | "lose"]
  | { type: "recover"; tick: number; bread: number; tier: number; x: number; y: number }
  | { type: "bossSpawn"; tick: number; pest: number; wave: number }
  | { type: "place" | "upgrade"; tick: number; slot: number; tower: TowerKind; tier: number; branch: TdBranch | null }
  | { type: "wave" | "waveStart"; tick: number; wave: number; targetTier: number; bonus: number }
  | { type: "spawn"; tick: number; pest: number; kind: PestKind; wave: number }
  | { type: "build"; tick: number; slot: number; tower: TowerKind; level: number }
  | { type: "sell"; tick: number; slot: number; refund: number }
  | { type: "shot"; tick: number; projectile: number; slot: number; target: number }
  | { type: "hit"; tick: number; projectile: number; pest: number; tower: number; damage: number }
  | { type: "kill"; tick: number; pest: number; bounty: number; x: number; y: number }
  | { type: "steal"; tick: number; pest: number; tier: number }
  | { type: "over"; tick: number; passed: boolean; reason: "cleared" | "bread" | "timeout" };
export interface TdState {
  tick: number; seed: string; level: number; map: number; coins: number;
  bread: number; breadTiers: number[]; wave: number; waveTargetTier: number;
  awaitingStart: boolean; startedTick: number | null;
  nextWaveTick: number | null; nextWave: TdWavePreview | null; dropped: TdDroppedBread[]; lost: number; spawning: boolean;
  batterPuddles: TdBatterPuddle[];
  pests: TdPest[]; towers: TdTower[]; projectiles: TdProjectile[];
  over: boolean; passed: boolean; inputsAccepted: number; inputsRejected: number;
  /** Detached events from the latest step/apply. Reading never drains them. */
  events: TdEvent[];
}
export interface TdGame {
  state(): TdState;
  step(toTick: number): TdEvent[];
  apply(input: TdInput): boolean;
  readonly over: boolean;
  readonly passed: boolean;
  readonly inputsAccepted: number;
  readonly inputsRejected: number;
}
export class TdReplayError extends Error {
  constructor(message: string) { super(message); this.name = "TdReplayError"; }
}

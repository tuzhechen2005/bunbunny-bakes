export const TD_ENGINE_VERSION = 1;
export const TICKS_PER_SECOND = 60;
export const FIELD_WIDTH = 720;
export const FIELD_HEIGHT = 1080;
/** Movement uses sixteenths of a field unit; drawing coordinates are integer field units. */
export const SUBUNITS = 16;
export const MAX_LEVEL_TICKS = 60 * 60 * 5;
export const MAX_INPUTS = 2000;
export const MAX_IGNORED_INPUTS = 120;
export const START_BREAD = 10;
export const WAVE_COUNT = 5;
export const PREP_TICKS = 600;

export interface TdPoint { x: number; y: number }
export interface TdMap { name: string; path: readonly Readonly<TdPoint>[]; slots: readonly Readonly<TdPoint>[] }
export type PestKind = "ant" | "mouse" | "sparrow" | "beetle";
export type TowerKind = "rollingPin" | "flourSifter" | "whisk" | "oven";
export interface TdPestSpec { kind: PestKind; hp: number; speed: number; bounty: number; armor: number }
export interface TdWave { pests: TdPestSpec[]; interval: number }
export interface TdLevel { seed: string; weekKey: string; number: number; map: number; startCoins: number; waves: TdWave[] }
export type TdOptions = ({ seed: string; level?: never } | { level: TdLevel; seed?: never }) & {
  /** Owner's tiers ordered cheapest first. Only their count/indices enter simulation. */
  tierCount?: number;
};
export type TdInput =
  | { tick: number; type: "place"; slot: number; tower: TowerKind }
  | { tick: number; type: "upgrade" | "sell"; slot: number }
  | { tick: number; type: "callWave"; slot: -1 };
export interface TdPest extends TdPestSpec, TdPoint {
  id: number; wave: number; distance: number; maxHp: number; slowed: boolean;
}
export interface TdTower extends TdPoint {
  slot: number; kind: TowerKind; level: number; spent: number; readyTick: number;
}
export interface TdProjectile extends TdPoint {
  id: number; kind: TowerKind; slot: number; target: number;
  fromX: number; fromY: number; targetX: number; targetY: number;
  bornTick: number; hitTick: number; damage: number; splash: number;
}
export type TdEvent =
  | { type: "wave"; tick: number; wave: number; targetTier: number; bonus: number }
  | { type: "spawn"; tick: number; pest: number; kind: PestKind; wave: number }
  | { type: "build"; tick: number; slot: number; tower: TowerKind; level: number }
  | { type: "sell"; tick: number; slot: number; refund: number }
  | { type: "shot"; tick: number; projectile: number; slot: number; target: number }
  | { type: "hit"; tick: number; projectile: number; pest: number; damage: number }
  | { type: "kill"; tick: number; pest: number; bounty: number }
  | { type: "steal"; tick: number; pest: number; tier: number }
  | { type: "over"; tick: number; passed: boolean; reason: "cleared" | "bread" | "timeout" };
export interface TdState {
  tick: number; seed: string; level: number; map: number; coins: number;
  bread: number; breadTiers: number[]; wave: number; waveTargetTier: number;
  nextWaveTick: number | null; spawning: boolean;
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

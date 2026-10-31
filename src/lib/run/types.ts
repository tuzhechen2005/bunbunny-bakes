export const RUN_ENGINE_VERSION = 1;
export const TICK_RATE = 60;
export const UNITS_PER_METRE = 1000;
export const MAX_RUN_TICKS = 15 * 60 * TICK_RATE;
export const MAX_INPUTS = 20_000;
/** Speeds are integer millimetres per tick. */
export const BASE_SPEED = 200;
export const CAP_SPEED = 500;
export const RAMP_TICKS = 120 * TICK_RATE;
export const MAX_SPEED = CAP_SPEED * 3 / 2;
export const JUMP_TICKS = 42;
export const SLIDE_TICKS = 36;
export const LANE_CHANGE_TICKS = 12;
export const MAGNET_TICKS = 8 * TICK_RATE;
export const COFFEE_TICKS = 6 * TICK_RATE;
export const MIN_REACTION_TICKS = 30;
export const MIN_REACTION_DISTANCE = MAX_SPEED * MIN_REACTION_TICKS;
export const ROW_GAP = 45_000;
export const VISIBLE_DISTANCE = 90_000;
export const LANES = [0, 1, 2] as const;
export type RunLane = typeof LANES[number];
export type RunDirection = "L" | "R" | "U" | "D";
export type RunObstacleKind = "cart" | "flour" | "awning" | "puddle";
export type RunObjectKind = RunObstacleKind | "bread" | "paper-bag" | "coffee";
export interface RunInput { tick: number; dir: RunDirection }
export interface RunObject {
  id: number;
  lane: RunLane;
  /** Relative millimetres ahead in snapshots; absolute millimetres in track chunks. */
  z: number;
  kind: RunObjectKind;
}
export interface RunLaneChange { from: RunLane; to: RunLane; progress: number }
export interface RunPlayer {
  lane: RunLane;
  pose: "run" | "jump" | "slide" | "lane-change";
  /** Integer 0..1000 progress of pose; run has zero progress. */
  progress: number;
  laneChange: RunLaneChange | null;
  queuedLane: "L" | "R" | null;
}
export type RunEvent =
  | { type: "action"; tick: number; dir: RunDirection }
  | { type: "collect"; tick: number; id: number; kind: "bread" | "paper-bag" | "coffee"; lane: RunLane }
  | { type: "expire"; tick: number; kind: "paper-bag" | "coffee" }
  | { type: "collision"; tick: number; id: number; kind: RunObstacleKind; lane: RunLane }
  | { type: "over"; tick: number; reason: "collision" | "limit" };
export interface RunState {
  tick: number;
  player: RunPlayer;
  objects: RunObject[];
  speed: number;
  /** Integer millimetres. Score uses floor(distance / UNITS_PER_METRE). */
  distance: number;
  bread: number;
  score: number;
  over: boolean;
  powerUps: { magnetUntil: number; coffeeUntil: number; magnetTicks: number; coffeeTicks: number };
  /** Events from the latest step/input operation; state() does not drain them. */
  events: RunEvent[];
}
export interface RunGame {
  step(toTick: number): RunEvent[];
  input(tick: number, dir: RunDirection): RunEvent[];
  state(): RunState;
}
export interface RunReplayResult { score: number; distance: number; bread: number; over: boolean; endTick: number }
export class RunReplayError extends Error {
  constructor(message: string) { super(message); this.name = "RunReplayError"; }
}

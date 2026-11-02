export const RUN_ENGINE_VERSION = 10;
export const TICK_RATE = 60;
export const UNITS_PER_METRE = 1000;
export const MAX_RUN_TICKS = 15 * 60 * TICK_RATE;
export const MAX_INPUTS = 20_000;
/** Speeds are integer millimetres per tick. */
export const BASE_SPEED = 480;
export const CAP_SPEED = 720;
export const RAMP_TICKS = 20 * TICK_RATE;
export const MAX_SPEED = CAP_SPEED * 3 / 2;
export const JUMP_TICKS = 42;
export const SLIDE_TICKS = 36;
export const LANE_CHANGE_TICKS = 12;
export const SHOES_TICKS = 8 * TICK_RATE;
export const MAGNET_TICKS = 8 * TICK_RATE;
export const COFFEE_TICKS = 6 * TICK_RATE;
export const MIN_REACTION_TICKS = 30;
export const MIN_REACTION_DISTANCE = MAX_SPEED * MIN_REACTION_TICKS;
export const ROW_GAP = 64_000;
export const VISIBLE_DISTANCE = 90_000;
export const LANES = [0, 1, 2] as const;
export type RunLane = typeof LANES[number];
export type RunDirection = "L" | "R" | "U" | "D" | "S";
export type RunObstacleKind = "cart" | "flour" | "awning" | "puddle" | "ramp" | "van" | "truck" | "pothole" | "bread-wheel";
export type RunObjectKind = RunObstacleKind | "bread" | "paper-bag" | "coffee" | "double-jump-shoes" | "shield";
export interface RunInput { tick: number; dir: RunDirection }
export interface RunObject {
  id: number;
  lane: RunLane;
  /** Relative millimetres ahead in snapshots; absolute millimetres in track chunks. */
  z: number;
  kind: RunObjectKind;
  front: number;
  back: number;
  height: number;
  speed?: number;
  /** Absolute signal deadline; snapshots use zero when no signal is scheduled. */
  signalUntil?: number;
  /** Adjacent truck destination; snapshots default to the current lane. */
  targetLane?: RunLane;
  /** Collectible elevation above the road. */
  y?: number;
  /** Bread value; 5 marks a golden loaf. */
  value?: 1 | 5;
  /** Moving roof owner, so its bread shares the truck displacement. */
  carrierId?: number;
  /** Authored two-obstacle phrase; both steps share the first obstacle ID. */
  comboId?: number;
  comboStep?: 1 | 2;
}
export interface RunLaneChange { from: RunLane; to: RunLane; progress: number }
export interface RunPlayer {
  shield: boolean;
  y: number;
  surface: "ground" | "roof";
  lane: RunLane;
  pose: "run" | "jump" | "slide" | "lane-change";
  /** Integer 0..1000 progress of pose; run has zero progress. */
  progress: number;
  laneChange: RunLaneChange | null;
  queuedLane: "L" | "R" | null;
}
export type RunStartMode = "normal" | "sprint" | "practice";
export interface RunDeath { id: number; kind: RunObstacleKind; lane: RunLane; reasonCode: "change-lane" | "slide" | "jump" }
export interface RunCombo { streak: number; level: 1 | 2 | 3; graceAvailable: boolean }
export type RunEvent =
  | { type: "combo"; tick: number; streak: number; level: 1 | 2 | 3; graceAvailable: boolean }
  | { type: "near-miss"; tick: number; id: number; kind: RunObstacleKind; lane: RunLane }
  | { type: "takeover-warning"; tick: number; controlTick: number }
  | { type: "control"; tick: number }
  | { type: "practice-cue"; tick: number; action: "change-lane" | "jump" | "slide" }
  | { type: "death"; tick: number; hit: RunDeath }

  | { type: "action"; tick: number; dir: RunDirection }
  | { type: "collect"; tick: number; id: number; kind: "bread" | "paper-bag" | "coffee" | "double-jump-shoes" | "shield"; lane: RunLane }
  | { type: "expire"; tick: number; kind: "paper-bag" | "coffee" | "double-jump-shoes" }
  | { type: "collision"; tick: number; id: number; kind: RunObstacleKind; lane: RunLane }
  | { type: "over"; tick: number; reason: "collision" | "limit" };
export interface RunState {
  startMode: RunStartMode;
  phase: "practice" | "sprint" | "running";
  controlTick: number;
  breadPoints: number;
  combo: RunCombo;
  death: RunDeath | null;

  tick: number;
  player: RunPlayer;
  objects: RunObject[];
  speed: number;
  /** Integer millimetres. Distance points use the current distance multiplier; breadPoints includes its combo. */
  distance: number;
  bread: number;
  multiplier: number;
  score: number;
  over: boolean;
  powerUps: { shoesUntil: number; shoesTicks: number; magnetUntil: number; coffeeUntil: number; magnetTicks: number; coffeeTicks: number };
  /** Events from the latest step/input operation; state() does not drain them. */
  events: RunEvent[];
}
export interface RunGame {
  step(toTick: number): RunEvent[];
  /** Borrowed mutable view for the live renderer; never retain across frames. */
  frame(toTick: number): RunState;
  input(tick: number, dir: RunDirection): RunEvent[];
  state(): RunState;
}
export interface RunReplayResult { score: number; distance: number; bread: number; over: boolean; endTick: number }
export class RunReplayError extends Error {
  constructor(message: string) { super(message); this.name = "RunReplayError"; }
}

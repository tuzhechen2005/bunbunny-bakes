export const GRAB_ENGINE_VERSION = 6;
export const MIN_TIERS = 3;
export const TICKS_PER_SECOND = 60;
export const RUN_TICKS = 60 * TICKS_PER_SECOND;
export const CLOCK_BONUS_TICKS = 5 * TICKS_PER_SECOND;
/** Hard ten-minute active-time safety ceiling, including every level and clock. */
export const MAX_RUN_TICKS = 36000;
export const MAX_LAUNCHES = MAX_RUN_TICKS;
export const MAX_IGNORED_LAUNCHES = 120;
export const FIELD_WIDTH = 720;
export const FIELD_HEIGHT = 1080;
export const PIVOT_X = 360;
export const PIVOT_Y = 0;
export const OVEN_X = 680;
export const OVEN_Y = 80;
export const FIELD_ITEMS = 8;
export const REFILL_DELAY_TICKS = 30;
export const BOMB_RADIUS = 57;
export const BLAST_RADIUS = 170;
export const BOMB_PENALTY_TICKS = 300;
export const BOMB_RESPAWN_TICKS = 300;
export const BOMB_LINE_CLEARANCE = 140;
export const BREAD_REFRESH_AGE = 601;
export const GRAB_MARGIN = 22;
export const SWING_PERIOD_TICKS = 300;
export const EXTEND_SPEED = 14;
export const EMPTY_REEL_SPEED = 18;

export interface GrabTierInput { id: string }
export type GrabKind = "bread" | "flour" | "butter" | "clock" | "bomb";
export type GrabSize = "S" | "M" | "L";
export type GrabStage = "raw" | "perfect" | "burnt" | "none";
export interface GrabItem {
  id: number;
  kind: GrabKind;
  /** Index into input tiers, or null for non-bread items. */
  tier: number | null;
  size: GrabSize;
  x: number;
  y: number;
  radius: number;
  weight: number;
  /** Ticks since spawning; frozen at contact for a held item. */
  age: number;
  stage: GrabStage;
  mouse?: boolean;
  golden?: boolean;
  /** Signed integer units per tick; zero for stationary bread. */
  velocityX?: number;
}
export interface GrabClaw {
  phase: "idle" | "extending" | "reeling";
  /** Integer degrees from downward vertical, positive to the right. */
  angle: number;
  length: number;
  x: number;
  y: number;
  held: GrabItem | null;
}
export interface GrabOrder { id: number; required: number[]; remaining: number[]; reward: number }
export interface GrabContactResult { item: number; stage: GrabStage; points: number; chain: number; multiplierPercent: number }
export type GrabEvent =
  | ({ type: "contact"; tick: number } & GrabContactResult)
  | { type: "order"; tick: number; completed: number; reward: number; order: GrabOrder }
  | { type: "level"; tick: number; level: number; target: number; duration: number }
  | { type: "explode"; tick: number; item: GrabItem; destroyed: GrabItem[]; penaltyTicks: number }
  | { type: "pop"; tick: number; item: GrabItem }
  | { type: "score"; tick: number; item: number; points: number; bonusTicks: number }
  | { type: "refill"; tick: number; item: GrabItem; from: { x: number; y: number } }
  | { type: "over"; tick: number };
export interface GrabState {
  tick: number;
  level: number;
  levelScore: number;
  levelTarget: number;
  completedOrders: number;
  perfectChain: number;
  nextPerfectBonusPercent: number;
  order: GrabOrder;
  pendingResult: GrabContactResult | null;
  claw: GrabClaw;
  items: GrabItem[];
  /** Integer ticks remaining (not milliseconds). */
  timeLeft: number;
  score: number;
  over: boolean;
  /** Completed deliveries, including non-bread items. */
  grabs: number;
  launchesAccepted: number;
  launchesRejected: number;
  /** Events from the latest step/launch; reading state does not consume them. */
  events: GrabEvent[];
}
export interface GrabGame {
  state(): GrabState;
  step(toTick: number): GrabEvent[];
  /** Advances to tick, then attempts a launch. False = busy or over. */
  launch(tick: number): boolean;
  readonly score: number;
  readonly over: boolean;
  readonly grabs: number;
  readonly launchesAccepted: number;
  readonly launchesRejected: number;
}

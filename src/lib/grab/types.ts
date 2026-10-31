export const GRAB_ENGINE_VERSION = 3;
export const MIN_TIERS = 3;
export const TICKS_PER_SECOND = 60;
export const RUN_TICKS = 60 * TICKS_PER_SECOND;
export const CLOCK_BONUS_TICKS = 5 * TICKS_PER_SECOND;
/** A conservative natural duration bound, not a gameplay cutoff; see README. */
export const MAX_RUN_TICKS = 6000;
export const MAX_LAUNCHES = MAX_RUN_TICKS;
export const MAX_IGNORED_LAUNCHES = 120;
export const FIELD_WIDTH = 720;
export const FIELD_HEIGHT = 1440;
export const PIVOT_X = 360;
export const PIVOT_Y = 0;
export const OVEN_X = 680;
export const OVEN_Y = 80;
export const FIELD_ITEMS = 8;
export const REFILL_DELAY_TICKS = 30;
export const SWING_PERIOD_TICKS = 300;
export const EXTEND_SPEED = 14;
export const EMPTY_REEL_SPEED = 14;

export interface GrabTierInput { id: string }
export type GrabKind = "bread" | "flour" | "butter" | "clock";
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
export type GrabEvent =
  | { type: "pop"; tick: number; item: GrabItem }
  | { type: "score"; tick: number; item: number; points: number; bonusTicks: number }
  | { type: "refill"; tick: number; item: GrabItem; from: { x: number; y: number } }
  | { type: "over"; tick: number };
export interface GrabState {
  tick: number;
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

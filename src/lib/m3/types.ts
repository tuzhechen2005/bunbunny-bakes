export const BOARD_SIZE = 8;
export const MIN_TIERS = 4;
export const MAX_TIERS = 6;
export const MAX_MOVES = 30;
export const MIN_MOVE_GAP_MS = 150;
export const M3_ENGINE_VERSION = 2;
export const REFILL_BIAS_PERCENT = 20;
export const MAX_CASCADE_STEPS = 20;
export const CELL_POINTS = 10;
export const ROLL_POINTS = 100;
export const BIG_POINTS = 200;
export const MAX_CHAIN_MULTIPLIER = 5;
export const ORDER_MIN_NEED = 18;
export const ORDER_MAX_NEED = 24;
export const ORDER_POINTS_PER_TILE = 20;
/** Codes retain the originating bread tier. Big breads do not participate in line matches. */
export const ROLL_BASE = 6;
export const BIG_BASE = 12;
export const EMPTY = -1;

export interface M3TierInput { id: string }
export interface M3Cell { r: number; c: number }
export interface M3Swap { a: M3Cell; b: M3Cell }
export interface M3Move extends M3Swap { at: number }
export interface M3Order { tier: number; need: number; have: number; points: number }
export interface M3Special extends M3Cell { kind: "roll" | "big"; tier: number }
export interface M3State {
  board: number[][];
  specials: M3Special[];
  movesLeft: number;
  score: number;
  orders: [M3Order, M3Order];
  over: boolean;
}
export interface M3Placement extends M3Cell { code: number }
export type M3Event =
  | ({ type: "swap" } & M3Swap)
  | { type: "match"; cells: M3Cell[]; points: number; chain: number }
  | { type: "special"; action: "created" | "fired" | "converted"; cell: M3Cell; kind: "roll" | "big"; tier: number; chain: number }
  | { type: "fall"; tiles: { from: M3Cell; to: M3Cell; code: number }[] }
  | { type: "refill"; tiles: M3Placement[] }
  | { type: "order"; action: "progress" | "complete" | "new"; index: 0 | 1; order: M3Order }
  | { type: "shuffle"; board: number[][] }
  | { type: "over" };
export interface M3Game {
  state(): M3State;
  swap(a: M3Cell, b: M3Cell): M3Event[] | null;
  readonly score: number;
  readonly over: boolean;
  readonly moves: number;
}

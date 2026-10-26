// Shapes shared by the game UI. The API shapes follow the L1 contract (POST /api/game/start etc.);
// the engine shapes are the small surface the UI needs from src/lib/game (see engine.ts).

export interface TierView {
  id: string;
  /** World units; the board is 1 wide. */
  radius: number;
  points: number;
  imageUrl: string | null;
  color: { bg: string; ink: string };
}

export interface StartedRun {
  runId: string;
  seed: string;
  tiers: TierView[];
  expiresAt: string;
}

export interface DropLog {
  x: number;
  /** Simulation step index of the drop. */
  at: number;
}

export interface FinishResult {
  score: number;
  best: number;
  rank: number;
  week: { start: string; end: string } | string;
}

export interface LeaderboardRow {
  rank: number;
  nickname: string;
  wechatMasked: string;
  score: number;
}

export interface Leaderboard {
  week: { start: string; end: string };
  top: LeaderboardRow[];
  lastWinner: { nickname: string; wechatMasked: string; score: number } | null;
  myBest?: number;
}

export interface Body {
  tier: number;
  x: number;
  y: number;
  r: number;
}

export type GameEvent =
  | { type: "drop"; tier: number; x: number; y: number }
  | { type: "merge"; tier: number; x: number; y: number; points: number; big: boolean }
  | { type: "over" };

/** What the UI needs from the deterministic engine. */
export interface RawEngine {
  /** Tier index of the piece that will be dropped (k = 0) or of the one after it (k = 1). */
  nextPiece(k?: number): number;
  drop(x: number): void;
  step(): void;
  state(): { bodies: Body[] };
  readonly score: number;
  readonly over: boolean;
  /** Returns the events since the last call and clears them. */
  drainEvents(): GameEvent[];
}

export interface CreateGameOptions {
  seed: string;
  tiers: { id: string; radius: number; points: number }[];
  width: 1;
  height: number;
}

// Shapes shared by the game UI. The API shapes follow the L1 contract (POST /api/game/start etc.);
// the engine shapes are the small surface the UI needs from src/lib/game (see engine.ts).

export interface TierView {
  id: string;
  /** World units; the board is 1 wide. */
  radius: number;
  points: number;
  imageUrl: string | null;
  color: { bg: string; ink: string };
  /** Display name (D107); the first character is drawn on a piece that has no picture. */
  name?: string;
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
  /** null when the server could not rank the run. */
  rank: number | null;
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
  id?: number;
  tier: number;
  x: number;
  y: number;
  r: number;
}

export type GameEvent =
  | { type: "drop"; tier: number; x: number; y: number }
  | { type: "merge"; tier: number; x: number; y: number; points: number; big: boolean }
  | { type: "over" };

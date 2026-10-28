# src/lib/tu — 兔了个兔 engine (contract C5)

Pure TS, deterministic: integer maths and the seeded PRNG from `src/lib/game/rng.ts` only (no
`Date.now`, no `Math.random`, no floats that could round differently). The client plays it, the
server re-plays the tap log with `replayTu`, and both get the same score. No DOM, no server code.

Decisions: D121–D124 in `docs/DECISIONS.md`.

## API

```ts
import { createTuGame, replayTu, TuReplayError, MAX_TAPS, MIN_TAP_GAP_MS, BOARD_W, BOARD_H, BAG_SIZE } from "@/lib/tu";

const game = createTuGame({ seed, tiers }); // tiers: { id: string }[], 2–8 bread tiers in tier order (no 大面包)
game.state(); // TuState (a fresh copy every call)
game.tap(tileId); // TuEvent[] | null
game.over; game.score; game.batch; game.taps; // read-only getters
replayTu(seed, tiers, taps); // { score, over, batch, taps } or throws TuReplayError
```

`createTuGame` throws `RangeError` for fewer than 2 or more than 8 tiers (a server configuration
problem, so `replayTu` lets it through instead of turning it into a `TuReplayError`). Only the
number of tiers matters to the engine; ids are for the UI. Every `tier` below is an index into
`tiers`.

### State

```ts
interface TuState {
  batch: number; // 1-based 炉
  tiles: { id: number; tier: number; x: number; y: number; layer: number; free: boolean }[];
  bag: number[]; // tier per slot, ≤ BAG_SIZE (6), equal tiers next to each other
  orders: [number, number]; // tier each customer wants (3 of it)
  score: number;
  over: boolean;
}
```

- Board: tiles are 1 × 1 squares; `x`, `y` are the top-left corner in tile units, multiples of
  0.5, with `0 ≤ x ≤ BOARD_W − 1` (7 wide) and `0 ≤ y ≤ BOARD_H − 1` (8 tall). The UI scales the
  unit grid (7 tiles ≥ 44 px fits 320 px). Layouts are left/right symmetric and centred; a batch
  may use only part of the board (batch 1 is small), so the UI may fit to the tiles' bounding box.
- `layer`: 0 = bottom. Draw in array order (bottom layers first). `free` = no tile on a higher
  layer overlaps it; covered tiles are dimmed and not tappable.
- Tile ids are unique for the whole game (each batch continues the count), so an id from a cleared
  batch is simply unknown.

### Events (in this order within one tap)

| event | fields | meaning |
| --- | --- | --- |
| `move` | `tile, tier, slot` | the tile left the board into bag slot `slot` (inserted after the last tile of the same tier, else at the end; later slots shift right) |
| `pack` | `tier, slot, points, order` | the 3 tiles at `slot..slot+2` were packed (later slots shift left by 3); `points` includes the order bonus; `order` = it filled an order |
| `order` | `index, tier` | order `index` (0/1) now wants `tier` (0–2 per tap) |
| `batch` | `batch, bonus` | the board was cleared: `bonus` points for it, batch `batch` (the new number) is dealt |
| `over` | — | the game ended (bag full without a pack, or `MAX_TAPS` reached) |

`tap` returns `null` (and changes nothing) for an unknown, already taken or covered tile, or when
the game is over. A tap that ends the game still moves the tile: `[move, over]`.

## Rules (D122)

- Bag of 6. When a move makes 3 of a tier, they pack at once. A move that leaves 6 in the bag
  without a pack ends the game.
- Two orders, each "3 of tier X", no timer, initially two different tiers from batch 1's board. A
  pack whose tier an order wants fills it (the first one if both want it); that order gets a new
  tier, seeded, from the tiers still on the board and not the other order's, when possible.
- When the board is empty the next batch is dealt. The bag is always empty at that moment (each
  tier comes in triples per batch, and the bag never holds 3 of a tier), so every batch starts
  fresh. After a deal, an order whose tier is not on the new board gets a new one.
- Scoring (constants exported): pack `PACK_POINTS × batch` (10), order bonus `ORDER_POINTS × batch`
  (+30), clearing a batch `BATCH_POINTS × batch` (+100, the cleared batch's number).
- `MAX_TAPS` (2000): the engine ends the game after that many taps, so client and server agree.

### Batches (`BATCHES` in deal.ts; batch n uses entry n, later batches repeat the last)

| 炉 | breads | layers | tiles |
| --- | --- | --- | --- |
| 1 | 4 | 3 | 30 |
| 2 | 4 | 4 | 42 |
| 3 | 5 | 4 | 48 |
| 4 | 6 | 4 | 54 |
| 5 | 7 | 5 | 66 |
| 6 | 8 | 5 | 78 |
| 7+ | 8 | 6 | 90 |

Breads per batch are capped at the shop's tier count and are the first k of a per-batch seeded
shuffle of all tiers.

### Solvable by construction

`dealBatch(seed, tierCount, batch)` builds the layout (positions only), then a random order in
which every position is free when its turn comes, then assigns tiers along that order in triples
(up to `spread` = 3 triples open at once, never 6 in the bag without a pack). That order is
returned as `solution` (the witness); `tests/unit/tuDeal.test.ts` plays it through the real engine
for batches 1–7 over 500 seeds (and 150 seeds for every shop size 2–7).

## Replay (server)

```ts
replayTu(seed, tiers, taps: { id: number; at: number }[]) // → { score, over, batch, taps }
```

`at` = integer ms since the run started on the client (`Math.round`), strictly increasing. Throws
`TuReplayError` for: not an array, more than `MAX_TAPS` taps, a tap that is not an object, a
non-integer id, a negative / non-integer `at`, non-increasing `at`, an unknown, taken or covered
tile, and any tap after game over. An unfinished run replays fine (`over: false`).

Timing plausibility is the server's job: reject gaps below `MIN_TAP_GAP_MS` (120) and a last `at`
beyond the real elapsed time plus slack.

## Tuning

`npx tsx scripts/tu-tune.mts [seeds] [tierCount]` runs the bots in `tests/support/tuBot.ts`
(`randomTu` taps any free tile; `greedyTu` finishes what is in the bag, starts a bread only when 3
are in reach, avoids filling the bag, prefers order breads). With 8 tiers over 1000 seeds: random
is out in batch 1 (96%), greedy reaches batch 4 median (p10 2, p90 6, mode 5). `tuTuning.test.ts`
pins these bounds. With 4 or fewer tiers the game is much easier (with 2 tiers the bag can never
fill and the game always runs to `MAX_TAPS`).

`hashTuState(state)` (FNV-1a) is for pinned vectors and debugging.

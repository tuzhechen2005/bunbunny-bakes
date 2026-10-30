# src/lib/tu — 兔了个兔 engine (contracts C5, C7, C8)

Pure TS, deterministic: integer maths and the seeded PRNG from `src/lib/game/rng.ts` only (no
`Date.now`, no `Math.random`, no floats that could round differently). The client plays it, the
server re-plays the log with `replayTu`, and both get the same score. No DOM, no server code.

Decisions: D121–D124, D128 (hidden tiles), D130 (curve), D131 (props), D132 (order rewards) in
`docs/DECISIONS.md`.

## API

```ts
import { createTuGame, replayTu, TuReplayError, MAX_TAPS, MIN_TAP_GAP_MS, BOARD_W, BOARD_H, BAG_SIZE, TU_ENGINE_VERSION } from "@/lib/tu";

const game = createTuGame({ seed, tiers }); // tiers: { id: string }[], 2–8 bread tiers in tier order (no 大面包)
game.state(); // TuState (a fresh copy every call)
game.tap(tileId); // TuEvent[] | null
game.use("peek" | "bag" | "swap"); // TuEvent[] | null
game.over; game.score; game.batch; game.taps; // read-only getters (taps = log entries, props included)
replayTu(seed, tiers, log); // { score, over, batch, taps } or throws TuReplayError
```

`createTuGame` throws `RangeError` for fewer than 2 or more than 8 tiers, or a tier with id `"big"` (a server configuration
problem, so `replayTu` lets it through instead of turning it into a `TuReplayError`). Only the
number of tiers matters to the engine; ids are for the UI. Every `tier` below is an index into
`tiers`.

### State

```ts
interface TuState {
  batch: number; // 1-based 炉
  tiles: { id: number; tier: number; x: number; y: number; layer: number; free: boolean; visible: boolean }[];
  bag: number[]; // tier per slot, ≤ bagSize, equal tiers next to each other
  orders: [number, number]; // tier each customer wants (3 of it)
  orderPoints: [number, number]; // bonus each order pays when filled = ORDER_POINTS × batch (the card's 「+N」, D132)
  props: { peek: number; bag: number; swap: number }; // props left
  bagSize: 6 | 7; // 7 after the "bag" prop, until the next batch is dealt
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
- `visible` (C7, D128): false when the union of the tiles on higher layers covers the whole
  square (all four half-unit quarters; exact integer test, `isHidden` in deal.ts), true otherwise.
  A free tile is always visible; a partly covered tile is visible (dimmed face). The UI must not
  render hidden tiles (their `tier` is in the state, the player must not see it) except during a
  peek. Layouts stack tiles exactly on top of each other (even layers share the grid) and the
  half-shifted odd layers hide tiles under the union of four neighbours, so taking a tile can
  reveal a bread the player did not know about.
- Tile ids are unique for the whole game (each batch continues the count), so an id from a cleared
  batch is simply unknown.

### Events

A tap returns, in this order:

| event | fields | meaning |
| --- | --- | --- |
| `move` | `tile, tier, slot` | the tile left the board into bag slot `slot` (inserted after the last tile of the same tier, else at the end; later slots shift right) |
| `pack` | `tier, slot, points, order` | the 3 tiles at `slot..slot+2` were packed (later slots shift left by 3); `points` includes the order bonus; `order` = it filled an order |
| `reveal` | `tiles` | ids (deal order) of tiles that were hidden before this tap and are visible now; only when non-empty; never the tiles of a newly dealt batch |
| `order` | `index, tier` | order `index` (0/1) now wants `tier`: first the filled order, then (after a deal) orders whose bread is not on the new board |
| `gain` | `p` | right after the filled order's `order` event: every `PROP_EVERY_ORDERS`-th (3rd) filled order grants one prop, chosen by the seeded RNG |
| `batch` | `batch, bonus` | the board was cleared: `bonus` points for it, batch `batch` (the new number) is dealt |
| `bagSize` | `size` | after `batch`, only when the extra slot was in use: the bag is back to 6 |
| `bonus` | `points` | the game ended: `PROP_BONUS_POINTS × batch` (50) per unused prop; always sent (may be 0), right before `over` |
| `over` | — | the game ended (bag full without a pack, or `MAX_TAPS` log entries) |

`use(p)` returns `[prop { p, left }]`, plus `bagSize { size: 7 }` for "bag" and two `order`
events (index 0, then 1) for "swap"; `[…, bonus, over]` if it was the `MAX_TAPS`-th entry.

`tap` returns `null` (and changes nothing) for an unknown, already taken or covered tile, or when
the game is over (hidden tiles are never free). A tap that ends the game still moves the tile:
`[move, bonus, over]` (or `[move, reveal, bonus, over]`). `use` returns `null` (and changes
nothing) for an unknown prop, none left, game over, or "bag" while the extra slot is already in
use this batch.

## Rules (D122, D131)

- Bag of 6. When a move makes 3 of a tier, they pack at once. A move that leaves `bagSize` in
  the bag without a pack ends the game.
- Two orders, each "3 of tier X", no timer, initially two different tiers from batch 1's board. A
  pack whose tier an order wants fills it (the first one if both want it); that order gets a new
  tier, seeded, from the tiers still on the board and not the other order's, when possible.
- When the board is empty the next batch is dealt. The bag is always empty at that moment (each
  tier comes in triples per batch, and the bag never holds 3 of a tier, whatever its size), so
  every batch starts fresh. After a deal, an order whose tier is not on the new board gets a new one.
- Scoring (constants exported): pack `PACK_POINTS × batch` (10), order bonus `ORDER_POINTS × batch`
  (+30), clearing a batch `BATCH_POINTS × batch` (+100, the cleared batch's number), at the end
  `PROP_BONUS_POINTS × batch` (+50) per unused prop.
- Props (D131, our own; no shuffle, undo or taking tiles out of the bag): 1 of each at the start
  (`START_PROPS`), +1 random one every 3rd filled order.
  - `peek`: the engine only spends it; the UI shows all hidden tiles for 3 s.
  - `bag`: `bagSize` 7 for the rest of this batch (once per batch; back to 6 when the next batch
    is dealt).
  - `swap`: both orders get new breads from the board, different from both old ones and from each
    other when the board allows it.
- `MAX_TAPS` (20000): the engine ends the game after that many log entries (taps and prop uses), so
  client and server agree.
- Props are never needed to clear a batch: the witness below works with any bag size, and
  `tuProps.test.ts` clears batches after using every prop.

### Batches (`BATCHES` in deal.ts; batch n uses entry n, later batches repeat the last)

| 炉 | breads | layers | tiles | spread | hidden at deal |
| --- | --- | --- | --- | --- | --- |
| 1 | 4 | 2 | 24 | 2 | ~8% |
| 2 | 5 | 4 | 36 | 3 | ~28% |
| 3 | 8 | 8 | 96 | 4 | ~54% |
| 4 | 8 | 8 | 108 | 4 | ~55% |
| 5+ | 8 | 8 | 120 | 4 | ~56% |

Batch 1 is the warm-up, batch 2 is where careless play stops, batch 3 is the wall (D130).

Breads per batch are capped at the shop's tier count and are the first k of a per-batch seeded
shuffle of all tiers.

### Solvable by construction

`dealBatch(seed, tierCount, batch)` builds the layout (positions only), then a random order in
which every position is free when its turn comes, then assigns tiers along that order in triples
(up to `spread` triples open at once, never 6 in the bag without a pack; `spread` must stay ≤ 4,
guarded at load). That order is returned as `solution` (the witness); `tests/unit/tuDeal.test.ts`
plays it through the real engine for every batch in `BATCHES` (+1) over 500 seeds (and 150 seeds
for every shop size 2–7). Hidden tiles change nothing here: the witness exists regardless of what
the player can see, and a tile is only taken in it when it is free (hence visible). A 7-slot bag
only makes it easier.

## Replay (server)

```ts
replayTu(seed, tiers, log: ({ id: number; at: number } | { p: "peek" | "bag" | "swap"; at: number })[]) // → { score, over, batch, taps }
```

`at` = integer ms since the run started on the client (`Math.round`), strictly increasing over
the whole log (taps and prop uses together). Throws `TuReplayError` for: not an array, more than
`MAX_TAPS` entries, an entry that is not exactly `{ id, at }` or `{ p, at }` (extra keys too), a
non-integer id, an unknown prop, a negative / non-integer `at`, non-increasing `at`, an unknown,
taken or covered tile, a prop that is not left or not usable, and anything after game over. An
unfinished run replays fine (`over: false`, no end bonus).

Timing plausibility is the server's job: reject gaps below `MIN_TAP_GAP_MS` (120) between any two
entries and a last `at` beyond the real elapsed time plus slack.

### Engine version (C8)

`TU_ENGINE_VERSION` (3) changes whenever a rules change would make an old log score differently
(this one: the higher tap cap changes when the unused-prop end bonus is paid). The server starts every run with `tuSeed(hex)` =
`v3.<hex>`, and `finishTuRun` refuses (422 「这一局已经过期，请重新开始」) a run whose
`tuSeedVersion(seed)` is not the current one; seeds from before versioning are plain hex =
version 1. So a run started before a deploy can simply not be finished (it would expire at the
weekly reset anyway and is cleaned up as an unfinished run) instead of being replayed under new
rules. The client includes the version in its autosave key, so old saves are dropped. Bump the
constant again with the next rule change.

## Tuning

`npx tsx scripts/tu-tune.mts [seeds] [tierCount]` runs the bots in `tests/support/tuBot.ts`. All
bots are information-limited: they choose from `playerView(state)`, which drops hidden tiles
(only for the one decision right after a peek do they see the whole board). `randomTu` taps any
free tile and never uses props; `greedyTu` (the tuning reference) finishes what is in the bag,
starts a bread only when 3 are in reach, avoids filling the bag, counts partly covered visible
tiles a little and prefers order breads; with props (default) it takes the extra slot when every
move would end the game, peeks before a risky move (no pack available, bag 2 short of full) and
swaps when neither order's bread can be seen. `diggerTu` is greedy plus a preference for tiles
lying on many visible tiles (a stronger player). With 8 tiers over 1000 seeds (end batch):

| bot | p10 / p50 / p90 | distribution |
| --- | --- | --- |
| random | 1 / 1 / 1 | 1: 93.5%, 2: 6.5% |
| greedy, no props | 2 / 3 / 3 | ≤2: 25.5%, 3: 67.6%, ≥4: 6.9% |
| greedy, props | 3 / 3 / 5 | ≤2: 8.7%, 3: 62.2%, 4: 17.5%, ≥5: 11.6% (props used p50: 4) |
| digger, props | 3 / 6 / 18 | long tail, 9% reach batch 19+ |

`tuTuning.test.ts` pins these bounds (200 seeds). With 4 or fewer tiers the game is much easier
(with 2 tiers the bag can never fill and the game always runs to `MAX_TAPS`).

`hashTuState(state)` (FNV-1a) is for pinned vectors and debugging.

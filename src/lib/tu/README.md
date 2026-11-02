# src/lib/tu — 兔了个兔 engine (contracts C5, C7, C8)

Pure TS, deterministic: integer maths and the seeded PRNG from `src/lib/game/rng.ts` only (no
`Date.now`, no `Math.random`, no floats that could round differently). The client plays it, the
server re-plays the log with `replayTu`, and both get the same score. No DOM, no server code.

Decisions: D121–D124, D128 (hidden tiles), D130 (curve), D131 (props), D132 (order rewards), D141 (prop cap), D187 (finite harder curve and bounded scoring) in
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
  orderPoints: [number, number]; // bonus each order pays when filled = ORDER_POINTS × min(batch, 5) (the card's 「+N」, D132)
  props: { peek: number; bag: number; swap: number }; // props left, 0..MAX_PROPS_PER_TYPE (2) per type
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
| `gain` | `p` | right after the filled order's `order` event: every `PROP_EVERY_ORDERS`-th (3rd) filled order draws one prop with the seeded RNG; emitted only if that type is below `MAX_PROPS_PER_TYPE` (2) |
| `batch` | `batch, bonus` | the board was cleared: `bonus` points for it, batch `batch` is dealt unless this is the terminal clear (batch stays 12) |
| `bagSize` | `size` | after `batch`, only when the extra slot was in use: the bag is back to 6 |
| `bonus` | `points` | the game ended: `PROP_BONUS_POINTS × batch` (50) per unused prop; always sent (may be 0), right before `over` |
| `over` | — | the game ended (bag full without a pack, 12 ovens cleared, or `MAX_TAPS` log entries) |

`use(p)` returns `[prop { p, left }]`, plus `bagSize { size: 7 }` for "bag" and two `order`
events (index 0, then 1) for "swap"; `[…, bonus, over]` if it was the `MAX_TAPS`-th entry.

`tap` returns `null` (and changes nothing) for an unknown, already taken or covered tile, or when
the game is over (hidden tiles are never free). A tap that ends the game still moves the tile:
`[move, bonus, over]` (or `[move, reveal, bonus, over]`). `use` returns `null` (and changes
nothing) for an unknown prop, none left, game over, or "bag" while the extra slot is already in
use this batch.

## Rules (D122, D131, D141)

- Bag of 6. When a move makes 3 of a tier, they pack at once. A move that leaves `bagSize` in
  the bag without a pack ends the game.
- Two orders, each "3 of tier X", no timer, initially two different tiers from batch 1's board. A
  pack whose tier an order wants fills it (the first one if both want it); that order gets a new
  tier, seeded, from the tiers still on the board and not the other order's, when possible.
- When the board is empty the next batch is dealt, except oven 12 ends the run. The bag is always empty at that moment (each
  tier comes in triples per batch, and the bag never holds 3 of a tier, whatever its size), so
  every batch starts fresh. After a deal, an order whose tier is not on the new board gets a new one.
- Scoring (constants exported): pack `PACK_POINTS × min(batch, 5)` (10), order bonus `ORDER_POINTS × min(batch, 5)`
  (+30), clearing a batch `BATCH_POINTS × min(batch, 5)` (+100, the cleared batch's number), at the end
  `PROP_BONUS_POINTS × batch` (+50) per unused prop.
- Props (D131, our own; no shuffle, undo or taking tiles out of the bag): 1 of each at the start
  (`START_PROPS`), one seeded random draw every 3rd filled order. D141 caps each type at
  `MAX_PROPS_PER_TYPE` (2): a full type grants nothing, consumes the RNG draw, and is never
  rerolled. No `gain` event is emitted, so the order-complete popup shows only the order points.
  Spending a prop makes room for future draws of that type.
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
| 3 | 6 | 6 | 54 | 3 | ~43% |
| 4 | 7 | 8 | 84 | 4 | ~55% |
| 5 | 8 | 10 | 108 | 4 | ~60% |
| 6 | 8 | 12 | 132 | 4 | ~65% |
| 7 | 8 | 14 | 156 | 4 | ~68% |
| 8–12 | 8 | 16 | 180 | 4 | ~71% |

Batch 1 is the warm-up, batch 2 is where careless play stops, D187 preserves the softer oven 3, then increases kinds and hidden layers.

Breads per batch are capped at the shop's tier count and are the first k of a per-batch seeded
shuffle of all tiers.

### Solvable by construction

`dealBatch(seed, tierCount, batch)` builds the layout (positions only), then a random order in
which every position is free when its turn comes, then assigns tiers along that order in triples
(up to `spread` triples open at once, never 6 in the bag without a pack; `spread` must stay ≤ 4,
guarded at load). That order is returned as `solution` (the witness); `tests/unit/tuDeal.test.ts`
plays it through the real engine for every batch in `BATCHES` over 500 seeds (and 150 seeds
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

D189 / D188-TU, owner 11/02: “不要动正在玩的局”. New starts use `tuSeed(hex)` =
`v6.<hex>`. The live pre-v6 version is **v5**, whose `v5.<hex>` seed retains the
D184 oven curve, uncapped oven reward multiplier and no 12-oven limit until it ends.
`createTuGame({ seed, tiers })`, `dealBatch(seed, tierCount, batch)` and `replayTu`
select those rules automatically. The RNG seed is never rewritten. `resumeTuGame(seed,
tiers, log)` validates/replays the saved log and returns the playable engine.

Both progress and finish admit seeds through `isSupportedTuSeed`: v5 and v6 only.
Plain-hex v1 and v2–v4 (also unknown future versions) remain rejected. Bare seed
labels are still supported for local simulations under v6, not server admission.
Weekly expiry, leaderboard queries, bans, snapshots and finished retries are unchanged.
A future engine upgrade must retain rules for supported in-progress runs too.

**Claude UI handoff (components intentionally untouched):**
- `TuPlay.tsx` already calls `createTuGame`; keep the original saved seed and tier snapshot.
  It now selects v5/v6 automatically. Resume may use `resumeTuGame` instead of its manual
  log loop; use state `orderPoints` for version-correct values.
- `tuSave.ts` must use `isSupportedTuSeed` when parsing and retain/read `bb_tu_save_v5`
  alongside `bb_tu_save_v6`. Its current sweep deletes v5, so remove that deletion for
  supported saves; write/clear the selected run's key (via `tuSeedVersion(seed)`), and
  remove only obsolete/expired saves. Do not relabel a v5 seed to v6.
- `TuPage.tsx` must pass the selected save's seed, tiers and taps unchanged into `TuPlay`
  and clear only that save on completion. Test actual localStorage discovery in the UI pass.
Engine tests cover serialized-save reconstruction and continued play; storage discovery is
pending this component wiring. `MAX_OVENS`, `MAX_SCORE_MULTIPLIER` and `BATCHES` describe
v6 defaults, not the limits of a resumed v5 run.

## Tuning

`npx tsx scripts/tu-tune.mts [seeds] [tierCount]` runs the bots in `tests/support/tuBot.ts`. All
bots are information-limited: they choose from `playerView(state)`, which drops hidden tiles
(only for the one decision right after a peek do they see the whole board). `randomTu` taps any
free tile and never uses props; `greedyTu` (the tuning reference) finishes what is in the bag,
starts a bread only when 3 are in reach, avoids filling the bag, counts partly covered visible
tiles a little and prefers order breads; with props (default) it takes the extra slot when every
move would end the game, peeks before a risky move (no pack available, bag 2 short of full) and
swaps when neither order's bread can be seen. `diggerTu` is greedy plus a preference for tiles
lying on many visible tiles (a stronger player). Bots read the current engine inventory before
using a prop, so they respect D141 without keeping their own grant counters. The following
historical D131 baseline predates the D141 cap (8 tiers, 1000 seeds, end batch):

| bot | p10 / p50 / p90 | distribution |
| --- | --- | --- |
| random | 1 / 1 / 1 | 1: 93.5%, 2: 6.5% |
| greedy, no props | 2 / 3 / 3 | ≤2: 25.5%, 3: 67.6%, ≥4: 6.9% |
| greedy, props | 3 / 3 / 5 | ≤2: 8.7%, 3: 62.2%, 4: 17.5%, ≥5: 11.6% (props used p50: 4) |
| digger, props | 3 / 6 / 18 | long tail, 9% reach batch 19+ |

`tuTuning.test.ts` checks the broad game-length bounds with the current rules (200 seeds). With 4 or fewer tiers the game is much easier
(with 2 tiers the bag can never fill, but the game ends after oven 12).

`hashTuState(state)` (FNV-1a) is for pinned vectors and debugging.

## UI contract

D184/D187 (owner 11/02), engine v6. The existing `batch { batch, bonus }` event still deals the
next oven immediately and awards only the cleared-oven bonus, except on the terminal clear:
`batch=12` stays unchanged, tiles are empty, and `bonus`, `over` follow in the same tap. New `state().canStop` is
true at each nonterminal boundary. Offer 收工 / continue; continuing is simply the next accepted tap
or prop use. Invalid inputs leave the window open. Prop use also closes it, so no prop
can be spent on the new oven and then cashed out against the old one.

`game.stop()` returns null outside this boundary or after ending. On success it consumes
one log entry, awards `50 × clearedOven × remainingPropCount` and returns the existing
`bonus { points }`, `over` events once. It sets `over=true`, `canStop=false`; `batch` remains
the already-dealt next oven. Use `batch - 1` as the cleared-oven count for cash-out.
No bonus is paid for a prefix/exit or for continuing. Normal loss still pays the current
oven multiplier. Finalization is idempotent at the engine and database levels.

Persist successful stop as `{ id: STOP_TILE_ID, at }`, where exported `STOP_TILE_ID = 0`
is reserved (real tile ids start at 1). `replayTu` recognizes it and calls `stop()`; it rejects
premature stops, repeats, and inputs after stop. During client restore, route id 0 to
`stop()`, ordinary ids to `tap()`. Existing finish/progress endpoints accept this strict
input shape and compute its score from replay, with the same timing checks.

`tuPlanning(state)` returns `{ slotsLeft, pairTiers, props }` without mutation or RNG.
`pairTiers` lists bag pairs only when two or fewer slots remain. Prop previews are:
`peek { usable, hiddenTileCount }`, `bag { usable, slotsAdded }`, and
`swap { usable, orderIndexes: [0,1] }`. These describe effects before spending; no hidden
bread tier or future random order is disclosed. Peek duration remains the existing UI's 3s.
D189 supersedes version invalidation: live v5 runs/saves retain v5 rules; only v1–v4 remain obsolete.

### D184 verification (v5)

All eight configurations: **11,200 witness oven clears** across 500 eight-kind seeds and
150 seeds for each shop size 2–7. On the review's 100 seeds, greedy median is oven **5** /
**253 inputs**, with no 600-input censoring; digger has 49 censored runs, reinforcing the
need for cash-out. Oven 3 still has 25/94 greedy failures versus oven 2's 4/98: the review's
no-doubling aspiration is **not met**. Two spread variants did not resolve it.
[Full measurements and reproduction](../../../docs/D184-validation.md).

### D187 verification (v6)

200 matched seeds per bot and revision, full runs: casual median oven 4 / 4,760 points;
strategy median oven 5 / 10,200 points, P90 23,200, maximum 40,470.
Pack/order/clear rewards use `tuScoreMultiplier`, capped at 5; unused props keep the
ending/cleared oven multiplier (at most 3,600 points), matching the existing UI preview; 12 ovens cap total possible score at
102,920 even if every pack matches an order and all six props remain. Cash-out pays once.
Historical leaderboard scores are retained: the shared queries do **not** filter TU versions.
[Comparison, histograms and checks](../../../docs/D187-validation.md).

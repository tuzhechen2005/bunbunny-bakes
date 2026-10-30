# M3 engine — S1 / D135

Pure TypeScript shared by client and server, with integer board/scoring arithmetic and the
existing seeded RNG in `../game/rng.ts`. No clock, global randomness, DOM, or server imports.
The engine resolves a move synchronously; rendering consumes its events at its own pace.

## Public API

```ts
import { createM3Game, replayM3, M3ReplayError, legalM3Moves } from "@/lib/m3";

const game = createM3Game({ seed, tiers }); // readonly { id: string }[]
const before = game.state();
const events = game.swap({ r: 2, c: 3 }, { r: 2, c: 4 }); // M3Event[] | null
const after = game.state();
const result = replayM3(seed, tiers, moves); // { score, over, moves: acceptedMoveCount }
```

Use the first six bread tiers, or all when there are four/five. Fewer than four throws
`RangeError` (including through replay: configuration error). IDs are presentation metadata;
only the selected tier count affects simulation. Supply bread tiers in configured order.

`state()` returns a fresh, fully detached snapshot:

- `board`: 8×8 row-major numbers; top-left is `{ r: 0, c: 0 }`.
- `specials`: row-major `{ r, c, kind: "roll" | "big", tier }[]`, derived from the board.
- `movesLeft`, `score`, `over`; readonly `game.moves`, `game.score`, `game.over` also exist.
- `orders`: exactly two `{ tier, need, have, points }` objects with distinct target tiers.

Board codes are stable regardless of tier count: ordinary bread `0..5`, rolling pin
`ROLL_BASE + tier` (`6..11`), big bread `BIG_BASE + tier` (`12..17`). `tierOf` and `kindOf`
decode codes (`kindOf` is for special codes only). Big breads retain their origin tier for
orders and indirect activation but do not match as ordinary bread. `EMPTY = -1` appears only
during event playback; a returned state is always full and settled.

Illegal swaps return `null` without consuming a move, changing state, or advancing either RNG.
This includes invalid coordinates, identical/nonadjacent cells, a swap that creates no match
or special combo, and swaps after game over. No live board injection or restore hook is exposed;
restore by replaying accepted moves from the seed.

## Rules and tie breaks (engine version 1)

- Initial boards have no matches and at least one legal move. Fill row-major, choosing a tier
  that cannot complete a horizontal/vertical triple; reject and regenerate a dead initial board.
- Ordinary and rolling-pin tiles match by bread tier in maximal horizontal/vertical runs of
  at least three. Resolve all simultaneous matches together. Intersecting runs form one group;
  L/T/cross groups use their **longest line**, not their total cell count. Separate groups each
  qualify for their own special.
- A longest line of four creates a rolling pin; five or more creates a big bread. Place it on
  an ordinary tile: prefer swap destination `b`, then source `a`, then the first row-major
  member of the group. In cascades, use the first row-major ordinary member. Existing specials
  always fire instead of being overwritten. If a group contains only specials, create none.
- The creation anchor is retained, not cleared or credited to orders, and survives that wave's
  effects. It can fall and activate in later cascades. A vertical four also creates a row-clearing
  rolling pin (there is no separate column-pin type).
- A matched pin clears its whole row. Any special reached by a clear fires once, recursively
  extending the same wave; count each cleared cell once. A big bread reached by an effect
  clears its origin tier. Merely swapping a pin with an ordinary bread requires a match.
- Big + ordinary is always legal and clears the ordinary bread's tier plus the big bread.
- Pin + pin clears the destination `b`'s row and column, consuming both pins. Other reached
  specials fire normally. The two initiating pins fire as the combo, not as extra row effects.
- Big + pin converts every other tile of the pin's tier (including another big of that tier)
  into a pin and fires all those pins. The initiating big fires once. Conversion earns no
  creation bonus, and converted tiles keep their bread tier for order credit.
- Big + big clears the entire board. Both fire once; other existing specials also fire once.
- Gravity compacts each column downward without changing survivor order. Refill with ordinary
  seeded bread, columns left-to-right and holes bottom-to-top. Resolve new matches until none
  remain. Chain numbering starts at 1 for each accepted swap.
- If no legal move remains, Fisher–Yates shuffle the exact multiset (including specials) until
  it has no matches and at least one legal move. Emit one `shuffle`; no score, order credit, or
  move cost. Shuffle also runs if necessary on the final board before `over`.
- Exactly **30 accepted moves**. Set `over` only after the final move's cascades settle.

## Scoring and orders

| Export | Final value | Meaning |
| --- | ---: | --- |
| `CELL_POINTS` | 10 | Per actually cleared cell, ordinary or special |
| `ROLL_POINTS` | 40 | Bonus for creating a pin through a line |
| `BIG_POINTS` | 100 | Bonus for creating a big bread through a line |
| `MAX_CHAIN_MULTIPLIER` | 5 | Wave score = (clear points + creation bonuses) × min(chain, 5) |
| `ORDER_MIN_NEED` / `ORDER_MAX_NEED` | 10 / 15 | Uniform inclusive quantity per new order |
| `ORDER_POINTS_PER_TILE` | 20 | Completion bonus = need × 20 (200–300), not chain-multiplied |
| `MAX_MOVES` | 30 | Engine-enforced accepted-move cap |
| `MIN_MOVE_GAP_MS` | 150 | Minimum gap between replay moves |
| `M3_ENGINE_VERSION` | 1 | Pin this with saved/server runs |

Orders use a separate `${seed}:m3:orders` RNG stream; board/refill/shuffle use
`${seed}:m3:board`. New orders choose among the selected tiers, excluding the other active
order's tier. Credit actual cleared cells, including a special's retained bread tier. Clamp
`have` to `need`, award the bonus, then replace completed orders in slot order. First update
both old orders before replacing either. Excess cells do not count toward a newly drawn order
in the same wave; that order can receive progress in the next cascade. New orders start at zero.

## Event playback contract

`swap` comes first. Each wave emits:

1. `special` with `action: "converted"`, then `"fired"` (zero or more), with `cell`, `kind`,
   `tier`, `chain`. Converted events replace the code; fired events are visual notifications.
2. `match { cells, points, chain }`: clear these unique row-major cells and add `points`.
   This includes all effect-cleared cells, plus creation bonuses in its score.
3. `special` with `action: "created"`: place the newly earned special at its retained anchor.
4. `order { action: "progress" | "complete" | "new", index, order }`: a detached order
   snapshot. Only `complete` adds the order's `points` to score.
5. `fall { tiles: [{ from, to, code }] }`, if nonempty: apply in given order (bottom-up per
   column). Then `refill { tiles: [{ r, c, code }] }`, if nonempty.

After all waves: optional `shuffle { board }` replaces the board, then optional `over`.
Events and state do not alias live internals. The events test reconstructs board, orders, score,
move count, and specials through full games, including a real automatic reshuffle.

## Replay and helpers

`moves` contains only accepted swaps, `{ a: { r, c }, b: { r, c }, at }`. `at` is safe-integer
milliseconds since start, nonnegative, strictly increasing, with gaps at least 150 ms. The first
move may be at zero. Empty logs and unfinished prefixes are valid. `M3ReplayError` rejects
nonarrays, more than 30 moves (necessarily also a move after over), malformed entries or
coordinates, invalid times, non-increasing times, short gaps, and illegal swaps. Because the
only ending condition is move 30, every move-after-over log is caught by the length check.
Server wall-clock plausibility, run ownership, and persistence belong to the later server task.

`legalM3Moves(state)` lists legal swaps in row-major order, right before down, once per pair;
returns none after over. `immediateM3Score(state, a, b)` computes only the first wave's visible
clear/creation/completion score, without gravity, future refills, or future orders.
`hashM3State(state)` is a full public-state FNV-1a debugging fingerprint, not a security hash.
`board.ts` contains pure rule helpers used directly by fixture tests; its board helpers expect
8×8 valid codes, and legal-move enumeration expects a settled board.

## Tuning

Run `npx tsx scripts/m3-tune.mts 1000 [tierCount=6]`. Bots use an independent seeded tie-break
stream and the same seeds `m3-tune0..m3-tune999`. Random chooses uniformly among legal swaps;
greedy maximizes immediate visible-board score including order completion bonuses, then breaks
ties randomly. It cannot see future RNG or simulate refills. Both play all 30 moves.
Percentiles use sorted index `floor(N × p)` (zero-based). Specials/game counts earned line
specials, excluding transient conversions; fired and converted counts are also printed.

Two 1,000-seed scoring candidates were compared:

| Candidate | Pin / big bonus | Chain cap | Order points/tile | Random median | Greedy median | Greedy earned specials/game |
| --- | --- | --- | --- | ---: | ---: | ---: |
| Lower bonuses | 20 / 60 | 3 | 15 | 2790 | 3930 | 7.705 |
| Selected | 40 / 100 | 5 | 20 | 3110 | 4660 | 9.164 |

The selected constants reward planning specials more clearly (49.8% median improvement over
random vs 40.9% for the lower bonuses), with more special creation during greedy play.
The 100-seed unit regression requires greedy median >1.35× random and >2× special creation.

| Bot, 1000 seeds / 6 tiers | Score p10 | p50 | p90 | Earned specials/game | Fired/game | Converted/game | Reshuffles/game |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Random | 2270 | 3110 | 4390 | 2.875 | 1.754 | 0.017 | 0.023 |
| Greedy | 3330 | 4660 | 6550 | 9.164 | 8.166 | 0.576 | 0.020 |

Tests cover 4/5/6 tiers, initialization, no-op rejections, full-game determinism and replay,
replay validation, exact special fixtures and combos, orders and score accounting, event
playback, reshuffling, greedy information limits, tuning bounds, and pinned version-1 vectors.

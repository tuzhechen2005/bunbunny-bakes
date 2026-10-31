# Run engine — R1 / D146

Pure TypeScript shared by client and server. Uses the existing seeded RNG in
`../game/rng.ts`; simulation has no clock, global randomness, DOM, or framework imports.
Version 1 is the original dawn bread-delivery route through a small stone-street town.
This directory implements simulation and replay only; rendering, server ownership,
wall-clock plausibility, persistence, leaderboard updates, and art are separate tasks.

## API

```ts
import { createRunGame, replayRun, RUN_ENGINE_VERSION } from "@/lib/run";

const game = createRunGame({ seed: "server-issued-seed" });
game.input(0, "L");
const events = game.step(60);
const snapshot = game.state();
const verified = replayRun("server-issued-seed", [{ tick: 0, dir: "L" }], 60);
// { score, distance, bread, over, endTick }
```

`RUN_ENGINE_VERSION = 1`. Store the version with the seed/log; changes to the rules,
constants, PRNG consumption, or ordering require a version bump before ranked deployment.
Restore a run by replaying its input prefix, then stepping to its saved tick. There is no
mutable state injection API. Empty and unfinished prefixes are valid for D136 reporting.

- `step(toTick)` advances to an absolute integer tick, stopping immediately at death or
  the 54,000-tick (15-minute) limit. It returns detached events for that operation.
- `input(tick, dir)` first advances **through** tick, then applies the swipe. A swipe at
  a collision tick is too late. Tick zero is valid. Directions are `L/R/U/D`.
- Log **every** valid swipe, including boundary, busy-action, or full-queue no-ops. Swipes
  must be strictly increasing (at most one per tick); there can be at most 20,000.
  The client must enforce the log cap rather than silently omit later swipes.
- Backward steps, malformed/unsafe/noninteger/out-of-range ticks, invalid directions,
  non-increasing input ticks, excess inputs, and input at/after game over throw
  `RunReplayError`. A future input that encounters death advances to that death and throws.
  Stepping an ended run forward is harmless and returns no events.
- `replayRun` validates the entire log before simulation, including exact `{ tick, dir }`
  entry shapes and `input.tick <= endTick`. Its returned `endTick` is the **actual**
  terminal/current tick, which may precede the requested tick after a collision.
- `state()` is detached and does not drain events or advance simulation/RNG. `events`
  repeats the latest operation's events; consume either that array or the method return,
  not both. Event batches depend on how calls are grouped; concatenated chronological
  events and all simulation fields are identical regardless of step batching.

Snapshots contain:

- `tick`, `distance` (integer **millimetres**), `bread`, `score`, `over`.
- `speed` in integer millimetres/tick. Divide distance by 1000 for metres;
  score is `floor(distance / 1000) + bread * 10`.
- `player.lane`: 0 left, 1 centre, 2 right. Starts at 1. `pose` is
  `run | jump | slide | lane-change`, with integer `progress` in 0..1000.
  `laneChange` independently exposes `from`, `to`, and progress so movement can overlap
  jumping/sliding. During a change, `lane` stays at the source until completion.
  `queuedLane` is null or the one queued horizontal swipe.
- `objects`: stable `id`, `lane`, `kind`, and relative forward `z` in millimetres,
  sorted by z then id. Objects extend 90 metres ahead; crossed objects are removed.
- `powerUps`: exclusive absolute `magnetUntil`/`coffeeUntil` ticks and nonnegative
  `magnetTicks`/`coffeeTicks` remaining. Until values retain the last expiry after ending.
- Events: accepted action starts (including queued starts), collections with object ids,
  power expiry, collision, and game over with `collision | limit` reason. Every event
  carries its simulation tick. Queuing/ignored swipes do not emit an action-start event.

## Fixed-tick rules

| Rule | Version 1 value |
| --- | --- |
| Tick rate | 60 Hz |
| Base / cap speed | 200 / 500 mm per tick (12 / 30 m/s) |
| Ramp | `200 + floor(300 * min(tick, 7200) / 7200)` |
| Coffee speed | `floor(baseSpeed * 3 / 2)`, maximum 750 mm/tick |
| Jump / slide | 42 / 36 ticks |
| One-lane change | 12 ticks, one extra horizontal swipe may queue |
| Paper bag / coffee | 480 / 360 ticks (8 / 6 seconds) |
| Chunk / obstacle row spacing | 135 / 45 metres |
| Minimum reaction budget | 30 ticks (500 ms), 22.5 metres at maximum coffee speed |
| Visible distance | 90 metres |

At tick t: expire powers/actions, finish a lane change and start its queued change, advance
by that tick's speed, then process every crossed object in z/id order. Collision uses a
swept crossing check, so accelerated movement cannot skip hazards. Finally apply the time
limit. A collision on the final tick takes precedence over the time-limit reason.

Jump/slide cannot interrupt or queue each other. Horizontal movement can overlap either.
A lane change occupies **both** source and target for collisions until it completes;
collectibles use the source lane until completion. Queue capacity is exactly one; additional
horizontal swipes while full are ignored, including opposite-direction ones. A boundary
swipe is a no-op, and a queued boundary swipe is checked when it starts.

Actions/powers starting at t end exclusively at t + duration. A power collected at t is
available to later objects processed at that tick; coffee changes movement beginning with
the next tick. On expiry, that tick's movement uses unboosted speed. Recollecting a power
refreshes its expiry to `collectionTick + duration`, without stacking durations. Bag and
coffee operate independently. Powers do not change jump/slide/lane-change durations.

| Object kind | Rule |
| --- | --- |
| `cart` | Blocks the lane; jumping/sliding cannot clear it |
| `flour` | Low flour stack; jump over it |
| `awning` | Slide underneath |
| `puddle` | Jump over it |
| `bread` | Collect one bread at crossing in the occupied lane |
| `paper-bag` | Collect in the occupied lane; magnet takes bread from all lanes at crossing |
| `coffee` | Collect in the occupied lane; boost and ignore all obstacle collisions |

The magnet does not attract power-ups. Jumping/sliding does not prevent bread or power
collection. Any unprotected collision ends the run immediately with no extra life.

## Solvability and bounded generation

`track.ts` uses the independent `${seed}:run:track:v1` RNG stream. Each chunk contains
three rows of two seeded obstacle types and one entirely open lane, plus bread lines leading
to that lane and occasional powers. The open lane can change by two lanes between rows.
No hidden route metadata is exposed to rendering/bots. Generation depends on distance and
seed, not current speed, frame cadence, state reads, or inputs.

The worst case includes a coffee pickup and a two-lane crossing. At 750 mm/tick,
45 metres leaves 60 ticks between rows: at least 30 ticks to react + 24 ticks to change
lanes + 6 ticks of margin. The same bound holds at spawn and across chunk boundaries.
The 90-metre view contains the next row before the previous row is crossed. Thus a player
can always choose the next open lane after crossing the previous row, without powers or
jump/slide. All slower speeds have more time. This is a constructive guarantee, not rejection
sampling or a probabilistic claim. Read-ahead generation and periodic removal of crossed
objects bound live memory independently of total run length.

## Verification and bots

Tests live in `tests/unit/run{Engine,Rules,Track}.test.ts`; bots in
`tests/support/runBot.ts` inspect only public state.

- `perfectRun`: follows each visible open lane immediately. Used for executable solvability
  and full-duration replay benchmarks; it does not depend on invulnerability to clear rows.
- `goodRun`: samples visible hazards at 10 Hz, reacts 15 ticks (250 ms) later, jumps/slides
  matching hazards and chooses open lanes around carts. Its effective recognition range
  is at most 21.5 metres / 44 movement ticks. It can be late on two-lane moves at high speed;
  it never peeks at RNG, replays alternate futures, or deliberately injects a death.
- `randomRun`: swipes a uniformly random direction every 12–36 ticks using a separate RNG.

Version-1 calibration, 100 fixed `tuning0..tuning99` seeds (seconds, sorted index floor(N*p)):

| Bot | p10 | Median | p90 | Collisions before 15 minutes |
| --- | ---: | ---: | ---: | ---: |
| Good | 128.23 | 312.13 | 900 | 76/100 |
| Random | 3.68 | 3.68 | 11.12 | 100/100 |

Tests check 1,000 seeds with 12 chunks each (36,000 rows), including boundary reachability
at maximum boosted speed, and execute live paths over those seeds. Additional checks cover
collision rules, exact power expiry, actions/queue limits, detached state/events, invalid
logs, live/replay equivalence, fixed scoring/version vectors, and the forced 15-minute end.
The warmed full 54,000-tick replay takes approximately 5 ms locally; the test budget is
100 ms. Run:

```sh
npx tsc --noEmit --incremental false
npx eslint src/lib/run tests/support/runBot.ts tests/unit/run*.test.ts
npx vitest run --configLoader runner --project unit
```

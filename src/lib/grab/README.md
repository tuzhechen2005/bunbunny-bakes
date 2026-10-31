# src/lib/grab — 兔兔夹面包 (G1 / D145)

Original grab-and-reel rules, shared by client and server. Pure TypeScript: integer field
coordinates, fixed integer ticks, integer scores, and the shared seeded RNG in `../game/rng.ts`.
No runtime clock, random global, DOM, framework, or server dependency. Geometry uses a baked
integer sine table and circle–segment tests on the swept claw tip; there is no runtime trig
or square root. All geometry intermediates stay within JavaScript's safe integer range.

## Public API

```ts
import {
  createGrabGame, replayGrab, GrabReplayError, GRAB_ENGINE_VERSION,
  TICKS_PER_SECOND, MAX_RUN_TICKS,
} from "@/lib/grab";

const tiers = [{ id: "a" }, { id: "b" }, { id: "c" }];
const game = createGrabGame({ seed: "server-issued-seed", tiers });
game.step(60);           // Simulate through tick 60; returns GrabEvent[].
game.launch(60);         // Advance, then launch. Boolean: accepted vs busy/over.
const snapshot = game.state();
game.score; game.over; game.grabs;
game.launchesAccepted; game.launchesRejected; // Read-only getters.

replayGrab("server-issued-seed", tiers, [60]);
// Full run: { score, over: true, grabs, launchesAccepted }.
replayGrab("server-issued-seed", tiers, [60], 90);
// Progress through tick 90 only; no credit for an item still being reeled.
```

`tiers` is readonly `{ id: string }[]`, at least 3 (`RangeError` otherwise). All supplied tiers
participate; there is no maximum or special reserved id. Item `tier` is a zero-based photo index,
independent of bread size; non-breads have `tier: null`. Only the count affects physics/RNG.

One tick is 1/60 second. The caller converts its elapsed time to an integer tick index; the
engine never reads time. `step(toTick)` accepts nondecreasing, nonnegative safe integers.
`launch(tick)` additionally requires strictly increasing attempted launch ticks. Invalid live
times throw `RangeError` without changing the game. Calling `step(t)` then `launch(t)` is valid.
The launch locks the angle at tick `t`; the first extension movement occurs at `t + 1`.
Busy inputs advance time but cannot cancel or redirect a grab; they increment the rejected count.
After expiry, time/physics freeze at the expiry tick; further launches return false.

`state()` is a detached snapshot (including nested held items/events). It contains:

- `tick`, `timeLeft` (both ticks), `score`, `over`, `grabs` (completed deliveries of any kind),
  `launchesAccepted`, and `launchesRejected`.
- `claw`: `phase` (`idle`, `extending`, `reeling`), integer `angle` in degrees from downward
  vertical (right positive), `length`, tip `x/y`, and `held` item or null.
- `items`: unique run-wide `id`, `kind`, `tier`, `size` (`S/M/L`), centre `x/y`, `radius`,
  `weight`, `age` in ticks, and `stage` (`raw/perfect/burnt`, or `none` for non-breads).
  Held-item position follows the tip; its age/stage remain frozen at contact.
- `events`: all events from the latest `step` or `launch`, in tick order. `state()` does not
  consume events; the next action replaces the batch (even when it advances zero ticks).

`step()` returns detached events as well. `launch()` can produce events while advancing even
if its new launch is rejected. Rendering must consume each action's batch once. Incremental
stepping and a single large step produce the same world and concatenated event sequence.

| Event | Fields | Meaning |
| --- | --- | --- |
| `pop` | `tick, item` | Item leaves the field; item snapshot records contact age/stage/position. |
| `refill` | `tick, item, from: { x, y }` | Newly spawned item at its settled position, animation origin at the top-right oven. |
| `score` | `tick, item` (id), `points, bonusTicks` | Delivery at the pivot; clocks score zero and grant 300 ticks. |
| `over` | `tick` | Countdown reached zero; no held-item credit. |

The engine supplies logical positions and animation events, not artwork or UI layout.

## Rules and tuning constants

- Field 720 × 600, pivot `(360, 0)`, oven animation origin `(680, 80)`.
- Idle angle follows a 300-tick triangular swing from −70° to +70° and back. Its phase is
  tied to the run's tick, including time spent reeling. A launch freezes the current angle.
- Extension is 12 units/tick. Contact uses the first circle met by the swept tip at one-unit
  length resolution; array order breaks an exact tie. At a field edge an empty claw returns.
- Empty return is 30 units/tick; held return is `max(1, 8 − 2 × weight)` units/tick.

| Item | Radius | Weight | Return speed | Base points |
| --- | ---: | ---: | ---: | ---: |
| Bread S | 26 | 1 | 6 | 100 |
| Bread M | 36 | 2 | 4 | 180 |
| Bread L | 46 | 3 | 2 | 300 |
| Flour | 44 | 8 | 1 | 20 |
| Butter | 25 | 0 | 8 | 20 |
| Clock | 25 | 0 | 8 | 0 (+300 ticks) |

Bread points are based on age **at contact**: ages 0–239 ticks are raw ×0.5; 240–540 inclusive
are perfect ×1.5; 541+ are burnt ×0.3. Thus exactly 4 seconds is perfect, exactly 9 seconds
is still perfect, and strictly after 9 seconds is burnt. Base points are multiples of 10,
so all awards are exact integers. `breadStage`, `breadPoints`, and `reelSpeed` are exported
pure helpers. Non-breads are unaffected by age.

Eight initial items start at age zero. Each contact schedules one replacement 30 ticks later,
even if the caught item is still returning. Slots are chosen from a seeded 5 × 3 lower-field
lattice with independent seeded x/y jitter (±22/±16 units). The spacing guarantees non-overlap
without retry loops, including at the largest radius. A refill may reuse the vacated slot;
the held item is no longer a field obstacle. Item ids never repeat.

The oven draws shuffled 32-item batches: 23 breads, 7 butter, 1 flour, 1 clock. Bread size and
photo tier are independently seeded. This gives rare clocks without an arbitrary bonus cap.
The same RNG stream controls batches, sizes, tiers, slots and jitter; busy inputs consume no RNG.

The initial deadline is 3600 ticks (60 seconds). A fully returned clock adds 300 ticks (5 seconds).
At the deadline, expiry runs **before** movement/refill/scoring: even a clock that would have
arrived on that exact tick cannot save the run. A held item remains visible in the frozen final
snapshot but earns nothing. There is no end bonus.

### Finite replay bound

`MAX_RUN_TICKS = 6000` is a conservative natural bound, not a gameplay timer cap. Every item
contact is at least 218 units below the pivot. Each completed grab takes more than 32 ticks
(19 outward and at least 28 inward with the fastest held return). At time `T`, at most
`9 + floor(T/32)` items can have spawned, including the initial eight and a pending grab.
With one clock per 32-item batch, a run's duration `T` satisfies
`T ≤ 3600 + 300 × ceil((9 + T/32)/32)`, which implies `T < 5636`. Thus stepping to 6000 always
finishes naturally. Even `step(Number.MAX_SAFE_INTEGER)` stops at the natural deadline.

## Replay validation and versioning

`replayGrab(seed, tiers, launches, toTick?)` accepts a readonly array of integer launch ticks.
Default `toTick = MAX_RUN_TICKS` finishes the run. Supply an explicit observation tick for
unfinished progress; launch ticks alone cannot encode elapsed time after the last input.
The result is exactly `{ score, over, grabs, launchesAccepted }`.

`GrabReplayError` (a named `Error`, following TU/M3) rejects:

- A non-array or more than `MAX_LAUNCHES` (6000) entries, checked before simulation.
- Negative, fractional, nonnumeric, unsafe, or non-increasing launch ticks.
- An observation tick outside `[0, MAX_RUN_TICKS]`, or a launch beyond that observation tick.
- A launch at/after the actual deadline, including after a previous launch already ended the run.
- More than `MAX_IGNORED_LAUNCHES` (120) busy launches. Exactly 120 are tolerated.

Configuration errors (fewer than 3 tiers) remain `RangeError`. Wall-clock plausibility and
suspicious-rate checks belong to G2; this engine does not trust or read wall time.
`GRAB_ENGINE_VERSION = 1` is exported. G2 will embed it in server-issued seeds. Bump it for any
future rules/RNG/geometry change that changes the score of an existing seed and input log.

## Bot measurements

`tests/support/grabBot.ts` contains both bots. Random launches after a seeded uniform 0–17 tick
delay each time the claw becomes idle, without inspecting targets. Greedy inspects only the
current public items, estimates visible ray hits over the next half-swing in two-tick increments,
and chooses points per travel-plus-wait time. It predicts contact age, avoids flour, and values
a clock's time bonus; it never sees future refills or clones the engine RNG. Both log actual
launches and simulate the same engine. Bot prediction may use floating point; engine/replay do not.

Reproduce with `npx tsx scripts/grab-tune.mts [seeds=200] [tiers=6] [seedPrefix=grab-tune]`.

| Corpus | Random mean score | Greedy mean score | Ratio | Greedy mean grabs |
| --- | ---: | ---: | ---: | ---: |
| `grab-tune0…199`, 6 tiers | 1336.83 | 3024.81 | 44.20% | 18.395 |
| `grab-check0…999`, 3 tiers | 1239.81 | 3037.642 | 40.81% | 18.689 |

The 200-seed unit regression requires a 40–60% score ratio and 15–20 mean completed greedy grabs.
Other tests cover deterministic events and snapshots, chunked stepping, replay/live equality,
bad logs, exact doneness/contact/delivery boundaries, clocks, timeout ties, refill separation,
snapshot isolation and maximum-input replay cost. The performance check requests the full 6000-tick
bound on a clock-extended real run with all 120 tolerated ignored inputs and requires every warmed
replay below 50 ms; a maximal 6000-entry hostile log must also reject within 50 ms.

```sh
npx tsc --noEmit
npx eslint .
npx vitest run --configLoader runner --project unit
```

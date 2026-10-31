# src/lib/grab — 兔兔夹面包 (G4 / D149)

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

- Field 720 × 1080 (2:3), pivot `(360, 0)`, oven animation origin `(680, 80)`.
- Idle angle follows a 300-tick triangular swing from −70° to +70° and back. Its phase is
  tied to the run's tick, including time spent reeling. A launch freezes the current angle.
- Extension is 14 units/tick. The entire swept tip uses `item.radius + 22` field units,
  including the coarse candidate test and one-unit contact scan. First contact wins; among
  simultaneous contacts, choose the centre nearest the tip line, then array order for exact
  ties. At a field edge an empty claw returns.
- Empty return is 14 units/tick; held return is `max(2, 17 − 4 × weight)` units/tick.
  Even the shortest edge miss takes 28 ticks outward and 28 inward (about 0.93 seconds total).
  Board input launches on primary pointer-down for touch/pen and left mouse presses, with a
  click fallback independent of touch capability. A 500 ms window after pointer events
  (including release) suppresses compatibility clicks; keyboard activation remains available.

| Item | Radius | Weight | Return speed | Base points |
| --- | ---: | ---: | ---: | ---: |
| Bread S | 41 | 1 | 13 | 100 |
| Bread M | 57 | 2 | 9 | 180 |
| Bread L | 73 | 3 | 5 | 300 |
| Flour | 44 | 8 | 2 | 20 |
| Butter | 25 | 0 | 17 | 20 |
| Clock | 25 | 0 | 17 | 0 (+300 ticks) |

Bread points are based on age **at contact**: ages 0–239 ticks are raw ×0.5; 240–540 inclusive
are perfect ×1.5; 541+ are burnt ×0.3. Thus exactly 4 seconds is perfect, exactly 9 seconds
is still perfect, and strictly after 9 seconds is burnt. Base points are multiples of 10,
so all awards are exact integers. `breadStage`, `breadPoints`, and `reelSpeed` are exported
pure helpers. Non-breads are unaffected by age.

At age 601 (`BREAD_REFRESH_AGE`), after 60 burnt ticks, the oven replaces field bread with
fresh raw bread of the same tier, size and position and a new run-wide id. It emits `refill`
without a `pop` or score; it consumes no RNG or item-deck draw and cannot create extra clocks.
Held bread never refreshes. This repeats throughout bonus time, so unattended bread cannot
stay burnt for the rest of the run. Its visual is a small crust border, never a dark photo filter.

Eight initial items start at age zero. Each contact schedules one replacement 30 ticks later,
even if the caught item is still returning. Slots are chosen from a seeded 4 × 4 lower-field
lattice with independent seeded x/y jitter (±14/±16 units). The spacing guarantees non-overlap
without retry loops, including at the largest radius. Column centres are 90/270/450/630;
row centres are 420/610/800/990. Item bounds span y=331…1079 (the lower 70%).
Bread radii remain 41/57/73, about 1.58× v1; shortening the height-fitted board makes the photos
larger on the same phone viewport. Visual diameters remain unchanged in field units; forgiving
hitboxes extend 22 units beyond the photo radius. A refill may reuse the vacated slot;
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
contact is at least 309 units below the pivot (331 minimum photo edge minus 22 tolerance).
Each completed grab takes more than 32 ticks (at least 23 outward and 19 inward with the
fastest held return). At time `T`, at most `9 + floor(T/32)` items can have been drawn from
the deck, including the initial eight and a pending grab. Automatic bread renewal draws
nothing from that deck and therefore does not affect the clock bound.
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
suspicious-rate checks live in `src/server/grab.ts` and `grabRules.ts`; this engine does not trust or read wall time.
`GRAB_ENGINE_VERSION = 4` is exported. Version 4 shortens the field, widens swept contact
and renews burnt field bread; v1/v2/v3 saves and server runs are rejected by the existing
version guards. `grabSeed(randomHex)` embeds it in server-issued seeds;
`grabSeedVersion(seed)` returns the encoded version or null for malformed/unversioned seeds. Bump it for any
future rules/RNG/geometry change that changes the score of an existing seed and input log.

## Bot measurements

`tests/support/grabBot.ts` contains both bots. Random launches after a seeded uniform 0–17 tick
delay each time the claw becomes idle, without inspecting targets. Greedy inspects only the
current public items, uses the shared swept-contact geometry over the next half-swing in two-tick increments,
and chooses points per travel-plus-wait time. It predicts contact age modulo the 601-tick bread renewal, avoids flour, and values
a clock's time bonus; it never sees future refills or clones the engine RNG. Both log actual
launches and simulate the same engine. Bot prediction may use floating point; engine/replay do not.

Reproduce with `npx tsx scripts/grab-tune.mts [seeds=200] [tiers=6] [seedPrefix=grab-tune]`.

| Corpus | Random mean score | Greedy mean score | Ratio | Greedy mean grabs |
| --- | ---: | ---: | ---: | ---: |
| `grab-tune0…199`, 6 tiers | 2391.97 | 4446.86 | 53.79% | 21.105 |
| `grab-check0…999`, 3 tiers | 2378.296 | 4451.822 | 53.42% | 21.146 |

G4 intentionally supersedes the old 25–35% ratio / 15–20 grab target: the owner asked for
clearly more forgiving play. The 200-seed regression now allows a 45–65% score ratio and
18–26 mean completed greedy grabs, retaining a strategy advantage without narrowing the hitbox.
The table records measurements, not a reason to tune away the requested forgiveness.
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

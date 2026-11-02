# Run engine — R14 / engine v9

Pure deterministic TypeScript shared by server replay and the client.
`RUN_ENGINE_VERSION = 9`; new seeds and the existing version-derived save key use
v9. Unfinished v1–v8 runs and saves are rejected; finished scores are unchanged.
The e2e SEED is v9. No components are changed and no browsers are run in this task.
The frontend must add the four new kinds to its object/art mapping before rendering
v9: `pothole`, `bread-wheel`, `double-jump-shoes`, and `shield`.

## API and snapshot contract

`createRunGame({seed})` exposes `input(tick, dir)`, `step(toTick)`, and detached
`state()`. `frame(toTick)` is a borrowed, pooled snapshot; never retain it across
frames. Realtime pre-generation and lazy server replay produce identical results.
All simulation is integer millimetres and 60 Hz ticks, without wall-clock reads.
Input advances **through** its tick before applying a swipe: collision-tick input
is too late. Log every valid swipe, including no-ops, at strictly increasing ticks.
Caps remain 20,000 inputs and 54,000 ticks (15 minutes). Replay validates the full
log before simulation and returns the actual end tick.

Every snapshot object exposes `id`, `kind`, `lane`, relative centre `z`, `front`,
`back`, `height`, `speed` (mm/tick, zero for static objects), `signalUntil` (absolute
tick, zero when no signal was scheduled; active while greater than the snapshot tick), and `targetLane` (current lane when no planned change).
Front/back are nonnegative extents from the centre. Objects sort by current z then
id. Collectibles also have `y`; golden bread has `value: 5`, ordinary bread defaults
to 1. Truck bread has `carrierId` and shares its carrier's lane and displacement.
All object and player fields are consistent between detached and pooled snapshots.

Player snapshots expose `y`, `surface`, `lane`, `pose`, progress (0..1000),
`laneChange`, `queuedLane`, and boolean `shield`. Lane changes take 12 ticks and
switch occupancy at their midpoint; one horizontal swipe may queue. Jump/slide
last 42/36 ticks and can overlap a lane change. Geometry remains in `geometry.json`.

## New obstacles and powers

- **Lane-changing trucks:** move toward the player at 40 mm/tick. At activation
  inside the 90m simulation window, a changing truck sets `signalUntil = tick + 60`
  and exposes its adjacent `targetLane`. At that tick it occupies the target lane.
  A truck changes only once. Its bread changes lanes simultaneously. Authored
  targets stay within the two blocked lanes, preserving the reserved route;
  when the open lane separates both blocked lanes, trucks keep their lane.
- **Potholes:** 4.4m long, requiring airborne feet throughout the swept overlap.
  Sliding or walking crashes. Jumping too early and landing in the hole, or starting
  too late at its approaching edge, also crashes. No height grace applies.
- **High-low combos:** an awning followed 26m later in the same lane by a pothole.
  Slide, then jump promptly; changing lanes is also allowed. Flour gates retain
  their 18m follow-up cart. The combo is tested at the maximum coffee speed.
- **Rolling bread wheels:** 1.8m high and 1.8m long, moving independently toward
  the player at 120 mm/tick. Jump or change lanes. Their movement uses the same
  deterministic activation and swept collision rules as trucks. Wheels start
  from 480m and only occupy middle rows, preserving recovery space.
- **Double-jump shoes:** `kind: "double-jump-shoes"`, active for 480 ticks (8s).
  `powerUps.shoesUntil` and `shoesTicks` expose expiry and remaining time. One
  additional jump is allowed while airborne, starting a new arc at current feet
  height. A third jump is ignored; landing resets eligibility. Recollection
  refreshes expiry, but does not reset the current airborne jump allowance.
- **Shield:** `kind: "shield"`, sets `player.shield = true`. One collision consumes
  it and emits a collision event without ending the run. The absorbed object's
  remaining depth is harmless; a different obstacle can crash immediately.
  Recollecting does not stack shields. Coffee still bypasses collisions without
  consuming a shield.

Each row has a seeded 1/96 chance of shoes and 1/96 chance of shield. Coffee and
magnet remain restricted to the introductory rows, each at 1/96 per row. Coffee
lasts 360 ticks and multiplies speed by 3/2; magnet lasts 480 ticks and attracts
bread across lanes and elevations. Roof bread otherwise requires roof support and
feet within 1800 mm of its elevation.

## Scoring

Snapshot `multiplier` is ×1 below 500m, ×2 from 500m, and ×3 from 1500m.
The current multiplier applies to distance points; bread value is unchanged:

```
score = floor(distance / 1000) * multiplier + bread * 10
```

Thus 500m earns 1000 distance points, 1500m earns 4500, and 1501m earns 4503.
Both live snapshots and authoritative replay use this same formula; save
verification and server finishing use authoritative replay.

## Difficulty and survivability

Speed remains 480→680 mm/tick over 35 seconds (coffee maximum 1020). Three 60m
rows form a 180m chunk, with a 30m initial offset and first obstacles at 90m (~3s).
The track RNG stream remains `${seed}:run:track:v1`, pinned by the enclosing v9 seed.
Density ramps from 240m to 720m, with mature ordinary draws 45% van, 25% truck,
30% street, overridden by action and roof phrases. New street obstacles start
at 240m; trucks and wheels start at 480m. Routes move at most one lane after 240m.
From 1260m, every third phrase requires two touching 12m van roofs with an approach
ramp and carts in the other lanes. From 2340m (~62s), every non-roof row requires
an action. Van roof heights, jump parabola, roof landing and gravity remain unchanged.

Spacing proof, supplemented by executed paths:

- Introductory two-lane crossings retain at least 57.4m, exceeding
  `1020 * (30 reaction + 24 crossing + 1 margin) = 56.1m`.
- Mature routes require at most one lane change. A roof train ends 18m after its
  row; the next truck envelope starts at most 18m before the next row. The 24m
  gap exceeds `1020 * (10 + 12 + 1) = 23.46m`.
- Wheels occur only in middle ordinary rows. A conservative 25m displacement
  envelope plus their 0.9m front and the preceding row's maximum 9m back leaves
  25.1m, also exceeding 23.46m. They never follow a combo or roof train.
- A combo's pothole ends 28.2m after its row. The next ramp starts at worst 13m
  before the next row, leaving 18.8m, exceeding the 13.26m lane-change requirement.
  The next route is already visible before the combo jump, so reaction/planning
  overlaps the action rather than starting after landing. Jump and lane change
  may run concurrently. Trucks and wheels are excluded from that next row.
- Truck lane changes never enter the reserved lane. Action centres are at least
  58 ticks apart at maximum speed, longer than either action. A 26m high-low gap
  lets a centred slide finish before the jump at 1020 mm/tick.

Tests inspect 1,000 seeds × 16 chunks, execute 1,000 early paths, and run 100 mature
search paths for 18,001 ticks (>5 minutes), asserting **zero absorbed collisions**
so shields cannot hide an unsolvable route. Paired roof/ground searches verify the
roof requirement. Search uses only public snapshots, including truck signals,
geometry and speeds, never generator route metadata.

Casual control samples at 10 Hz, delays inputs 250ms and randomly selects apparently
open lanes. Intermediate control also delays inputs 250ms, independently queues
lane/action decisions, and plans 72 ticks ahead with sampling allowance. Search
plans 120 ticks ahead and acts without motor delay. Calibration uses 100 fixed
`tuning0..tuning99` seeds and median index 50: casual target 12–20s (~15s),
intermediate 60–120s, search at least 3 minutes. Measured seconds (sorted indices 10/50/90):

| Bot | p10 | Median | p90 |
| --- | ---: | ---: | ---: |
| Casual | 12.55 | 17.88 | 26.15 |
| Intermediate (250ms) | 38.23 | 73.53 | 101.48 |
| Search (100 mature tracks, capped) | 300.02 | 300.02 | 300.02 |

The search result uses `survive0..survive99`; all finish the 18,001-tick horizon
without a collision, including shield absorption. The full 15-minute replay and
20,000-input replay tests also pass their 100ms budgets. The final broader unit run also passes both 1,000-seed tests (spacing 11.69s,
executed early paths 14.82s), after earlier host-load timeouts.

## Verification

```
npx prisma generate
npx tsc --noEmit --incremental false
npx eslint
npx vitest run --configLoader runner --project unit --maxWorkers 1 --pool threads
TEST_DATABASE_URL=postgresql://bunbunny:bunbunny@localhost:5432/bunbunny_r14_test npx vitest run --configLoader runner --project db
```

Verification results: ESLint and `git diff --check` pass. All 1,217 unit cases are
covered successfully: 1,207 in the 97-file run excluding TD calibration, six TD
calibration cases in the original full run, and the remaining four on isolated
retry after host-load timeouts. All 829 DB cases are covered successfully on
`*_test` databases: the full thread-pool run passed 828, and the timezone-switching
`dbDates` file passed all 12 when rerun with the normal fork pool. Threads cannot
apply `process.env.TZ` changes to native Date behavior. The runner DB file also
passes all nine tests with forks, including final multiplier scoring and v8 rejection.
No browser/e2e execution was performed.

TypeScript currently reports the frontend's exhaustive `runRenderer.ts` object
map missing the four new kinds. It is intentionally left for the frontend task
because R14 forbids edits to `src/components/**`; types are not weakened to hide it.

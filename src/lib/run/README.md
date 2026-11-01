# Run engine — R13 / engine v8

Pure deterministic TypeScript shared by replay and the client. `RUN_ENGINE_VERSION = 8`;
new seeds and saves use `v8.`. Unfinished v1–v7 runs/saves are rejected, with existing
scores unchanged. Rendering is a separate frontend task: its object/art mapping must
add `ramp`, `van`, and `truck` and use the new elevation/geometry fields.

## API and limits

`createRunGame({seed})` exposes `input(tick, dir)`, `step(toTick)`, and detached `state()`.
`replayRun(seed, inputs, endTick)` verifies the same simulation. `frame(toTick)` returns
a borrowed pooled snapshot; realtime mode pre-generates the finite track. Do not retain
borrowed frames. Reads never advance simulation or RNG.

Ticks are integers at 60 Hz. Input advances **through** its tick before applying the
swipe: input on a collision tick is too late. Log all valid swipes, including no-ops,
strictly increasing, at most one per tick. Caps remain 20,000 inputs and 54,000 ticks
(15 minutes). Replay validates the entire log, exact entry shapes, bounds and ordering
before simulation. Invalid logs throw `RunReplayError`; stepping an ended game is harmless.
The returned endTick is the actual collision/current tick, not the requested tick.
Server request-size and plausibility limits continue to derive from these caps.

Snapshots expose speed, distance (integer mm), bread, score, over, powers and events.
Score remains `floor(distance / 1000) + bread * 10`, including roof bread.
Every object exposes `id`, `kind`, `lane`, relative centre `z`, `front` and `back`
(nonnegative extents from that centre), and `height`, all in mm. Trucks additionally
expose `speed` in mm/tick; collectibles expose `y` for their road/roof placement.
Objects sort by current z then id. Roof bread can extend up to 16m beyond a chunk's
nominal end; the following chunk's first object remains farther ahead.

`player.y` is integer feet height above the road. `surface` is `ground | roof`;
ramps count as elevated support. During an airborne roof exit surface becomes ground
while y falls toward zero. `pose`, progress (0..1000), laneChange and queuedLane retain
their existing meanings. Lane occupancy switches at the 12-tick change's midpoint;
one horizontal swipe may queue. Jump/slide last 42/36 ticks, cannot interrupt each
other, and can overlap lane changes. Slides work on roofs. Falling cannot start a
second midair jump.

## Geometry and collision

`geometry.json` is the renderer/engine geometry contract. It contains all vehicle
length bounds, roof/ramp heights, truck speed, gravity, existing obstacle dimensions,
standing/sliding heights, jump apex (3600 mm), and projection constants.

- Ramps are 4000 mm long and rise linearly from ground to 2600 mm. Their far end
  meets the approaching face of a van, including ticks straddling that seam.
- Parked vans are 12000–18000 mm long, 2600 mm high. Their front or side crashes
  a ground player. A correctly timed jump clears the face and lands on the roof.
- Trucks are 12000 mm long and 2600 mm high. On entering the 90m simulation window,
  they move toward the player by `TRUCK_SPEED = 40` mm each tick, in addition to
  player motion. Their roof can also be landed on. Movement activation is identical
  in lazy replay and realtime pre-generation and independent of input/step batching.
- Roof exits fall by integer gravity, increasing downward speed by 32 mm/tick each
  tick. Jumps use the shared integer parabola relative to takeoff elevation; descending
  feet land on a supporting roof. Equal-height roof-to-roof contact is safe.
- Ground obstacles do not hit feet above their height. Existing ground jump/slide
  rules retain the 160 mm depth inset and up to 120 mm height grace. Vehicle roofs
  require actual 2600 mm clearance. Cart height remains 4400 mm.
- Collision sweeps the full per-tick relative interval, including truck motion.
  Coffee ignores collisions for 360 ticks and applies 3/2 speed; magnet lasts 480
  ticks and attracts bread in all lanes and elevations. Recollecting refreshes expiry.
  Ground pickups retain the existing jump/slide collection behavior. Roof bread
  requires roof support and feet within 1800 mm of its elevation unless magnetized.
  Golden loaves remain `kind: "bread"` with `value: 5`; ordinary loaves default to 1.
  Truck bread exposes `carrierId` and `speed` and shares its carrier's displacement.

## Patterns and tuning

Base speed is 480 mm/tick (28.8 m/s), rising to 680 (40.8 m/s) over
2100 ticks (35 seconds); coffee caps at 1020. The independent seeded track stream
is `${seed}:run:track:v1`; the enclosing v8 seed pins these rules. Three 60m rows
form each 180m chunk, with a 30m initial offset. The first wall is at 90m, reached
at about second 3.

Density ramps from 240m to 720m. Ordinary draws reach 45% van, 25% truck, 30%
street, before authored phrase overrides. Trucks are eligible from 480m, in middle
rows (first possible centre 510m, encountered around 16s). Other truck draws become
ramped vans, preserving recovery space after gates. Routes may change every row,
but move at most one lane after 240m.

From 360m, alternating phrases put an action gate in their middle or final row:
two carts block the side lanes, flour or an awning fills the remaining lane, and a
cart follows that lane 18m later. This requires a jump/slide and then a lane change.
From 2340m (about 62s without coffee), every non-roof row has this combination,
leaving no empty lane at its centre. At cap speed the follow-up arrives 0.44s later.
This is the mechanical pressure target for experienced humans; no human playtest
was performed for this backend task.

From 1260m, every third phrase requires roofs: three rows each have two touching
12m vans in the route lane, one approach ramp, and carts in both other lanes.
There is no ground route through the wall. Each 24m train ends in a golden loaf
worth five bread; ordinary ramped vans also retain roof lines and a final gold.
Most mature bread remains on roofs. Vehicle/action rows have one ground guide loaf;
action rows no longer award a free ground exit line. Some trucks carry three loaves.
Coffee is now 1/96 per introductory row (formerly 1/24); only the first three rows
can have powers. Magnet has the same 1/96 draw and still attracts both elevations.

The 60m spacing preserves the maximum-coffee-speed bound. Early rows leave at
least 57.4m, exceeding 1020 × (30 reaction + 24 crossing + 1 margin) = 56.1m.
Mature routes move at most one lane. A roof train ends 18m after its row; the
conservative truck envelope begins 18m before the next, leaving at least 24m,
exceeding 1020 × (10 + 12 + 1) = 23.46m. Following an action row, trucks are
excluded; its 19.4m rear and the next ramp's 13m approach leave 27.6m.
The gate-to-follow-up gap leaves over 15m for a 12-tick lane change even at 1020.
Consecutive action centres are at least 58 ticks apart, longer than either action.
The next route is visible before choosing which side to take around the follow-up.
These bounds supplement executed paths; roofs/actions are now part of the proof.

Tests inspect 1,000 seeds × 16 chunks, execute early routes over 1,000 seeds, and run
100 independent mature tracks for 18,001 ticks (>5 minutes). Another 100 paired
tracks verify that ground-only control dies while roof-capable search survives.
The former R10 requirement that ground-only play survive is intentionally replaced.
`perfectRun` searches a 120-tick lane graph from public snapshots, treats contiguous
ramped roofs as support, and schedules mandatory jump/slide gates from visible
geometry. It never reads reserved-route metadata. Mature sections have no powers.
`casualRun` is unchanged: 10 Hz samples, 15-tick motor delay, random choice among
apparently open lanes, and visible jump/slide timing. `randomRun` swipes every 12–36 ticks.

100 fixed `tuning0..tuning99` seeds, seconds (sorted index floor(N*p)):

| Bot | p10 | Median | p90 |
| --- | ---: | ---: | ---: |
| Casual | 12.58 | 17.88 | 21.27 |

The calibration assertion is 12–20 seconds median. Full 15-minute search logs
exercise bounded replay, input caps, and time-limit termination. Capped-input
padding inserts busy action no-ops and quiet-interval jumps without masking gates.
Replay retains the 100ms budget. Existing queue, collision, roof seam, moving truck,
live/lazy equivalence, invalid-log, detached-state, seed/save/server checks remain.
The e2e SEED is v8; browser execution is excluded from this task.

```sh
npx prisma generate
npx tsc --noEmit --incremental false
npx eslint
npx vitest run --configLoader runner --project unit --maxWorkers 1
TEST_DATABASE_URL=postgresql://bunbunny:bunbunny@localhost:5432/bunbunny_run8_test npx vitest run --configLoader runner --project db
```

# Run engine — L1 / engine v6

Pure deterministic TypeScript shared by replay and the client. `RUN_ENGINE_VERSION = 6`;
new seeds and saves use `v6.`. Unfinished v1–v5 runs/saves are rejected, with existing
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
Objects sort by current z then id. Roof bread can extend up to 9m beyond a chunk's
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
  requires feet within 1800 mm of its elevation unless magnetized.

## Patterns and tuning

Base speed is 320 mm/tick, rising to 500 over 4500 ticks; coffee caps at 750.
The independent seeded track stream is `${seed}:run:track:v1` (the enclosing v6
seed pins the new rules). Three 45m pattern centres form each 135m chunk.

`RUN_PATTERNS` is a distance-weighted library: friendly street obstacles give way to
base draws of 45% ramp/van, 25% moving truck, 30% street obstacles in blocked lanes.
The phrase rules below override calm approaches and truck-free exits. The transition
starts at 600m and reaches mature density at 1400m (roughly 60 seconds without coffee).
Repeated van patterns make trains with approach ramps and roof bread lines. Long
vehicle footprints make mature patterns denser and require consecutive lane changes.
The reserved ground route remains clear; it changes at most one lane per mature row.
Early rows keep two-lane choices and the old 30-tick reaction allowance. Powers occur
only in the friendly section, so survival of mature patterns does not rely on coffee.

The route guarantee includes chunk boundaries and maximum coffee speed: an oncoming
truck moves under 12m before passing the player, even at the slowest base speed.
The worst mature free interval is 45m minus a 9m preceding rear and an 18m approaching
truck envelope = 18m. At 750 mm/tick that leaves 24 ticks: 10 reaction ticks + a
12-tick lane change + margin. Actual current speeds give more time. Early rows retain
30 reaction ticks + two changes. Ramps and roof lines add optional routes/rewards.

Tests inspect 1,000 seeds × 12 chunks, execute early routes over 1,000 seeds, and run
100 independent mature tracks for more than five minutes. `perfectRun` searches a
120-tick time/lane graph using only public snapshots and swept lane occupancy; it
never reads reserved-route metadata or depends on powers to bypass obstacles.
`casualRun` (`goodRun` compatibility alias) samples at 10 Hz, waits 15 ticks, chooses
randomly among apparently open lanes, and times jumps/slides from visible hazards.
`randomRun` swipes random directions every 12–36 ticks.

100 fixed `tuning0..tuning99` seeds, seconds (sorted index floor(N*p)):

| Bot | p10 | Median | p90 |
| --- | ---: | ---: | ---: |
| Casual | 34.18 | 44.27 | 70.50 |

Calibration checks require at least 80/100 casual deaths between 30 and 60 seconds.
Full 15-minute perfect logs also exercise bounded replay, input caps and time-limit
termination. The warmed capped-input replay median (three samples) must stay below
100 ms; the ordinary full-run replay also retains its 100 ms check. Roof tests cover seams, front collisions, timed landings, slides, bread,
falling and moving-truck batch/live equivalence. Existing queue, power, geometry,
invalid-log, detached-state and seed/save/server checks remain in place.

```sh
npx tsc --noEmit --incremental false
npx eslint
npx vitest run --configLoader runner --project unit --maxWorkers 1
TEST_DATABASE_URL=postgresql://bunbunny:bunbunny@localhost:5432/bunbunny_run6_test npx vitest run --configLoader runner --project db
```

No browser checks are part of this backend task.


## L1 authored track phrases and early-input regression

After the 600m introduction, three-row phrases alternate calm approaches and
vehicle bursts. Every other phrase opens with street obstacles, the middle row
allows oncoming trucks, and the exit keeps the middle row's open lane and converts
truck draws into ramped vans. A three-loaf reward follows that exit. Each van still
has a contiguous 4m approach ramp and a roof-height bread line. Ground bread
identifies the safe lane; side loaves appear only alongside an early paper bag.
The truck visibility window stays 90m and the reserved-lane/reaction-distance proof
still covers its full movement envelope, including maximum coffee speed.

The reported tick-six regression is not a v5 collision or input rule: both left
and right inputs on `v5.abcdef0123456789` work in lazy and realtime engines, complete
by tick 18, and survive replay/resume. The page gates input on asynchronous renderer
readiness. The e2e fixture now advances its installed clock while waiting for a
positive simulation tick before sending a gesture. Unit tests reproduce both old
and new seeds at ticks 6, 21 and 27; no browser was used for this work.

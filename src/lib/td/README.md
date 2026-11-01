# 保卫大面包 — L2 engine v6

Pure deterministic TypeScript, shared by client saves and authoritative server replay.
No DOM, clock, photos, frame delta, or global randomness enters simulation. The server
continues deriving the weekly level from the same Monday and level number.

## Inputs, versions and saves

Canonical seed: `v6.td.<Monday YYYY-MM-DD>.<positive level>`. Versions 1–5 runs and saves
are rejected. `TD_ENGINE_VERSION` also drives the existing save key and server gate.
Pass either `{ seed, tierCount }` or `{ level: tdLevel(week, n), tierCount }` to
`createTdGame`; descriptors are regenerated from their seed, never trusted.
`replayTd(options, inputs, endTick)` reconstructs the same detached snapshot.

Inputs have exact keys, safe integer ticks (0–18000), and slots 0–10:

```ts
{ tick: 0, type: 'place', slot: 0, tower: 'rollingPin' }
{ tick: 0, type: 'upgrade', slot: 0 } // tier 0 -> 1
{ tick: 0, type: 'upgrade', slot: 0, branch: 'a' } // tier 1 -> 2
{ tick: 0, type: 'sell', slot: 0 }
{ tick: 0, type: 'callWave', slot: -1 }
```

Branch is required only for the second upgrade; supplying it earlier is rejected.
There is no hero skill. Sell refunds half the total spend, floored. Upgrade retains
the current cooldown. A sold tower's existing shots and burns remain active.
Malformed inputs do not advance time; legal-shaped rejected actions advance first.
Replay validates the entire log, including its tail, before simulation. Limits remain
2000 inputs, 120 ignored actions, five minutes, 60 ticks/second. Same-tick log order
matters. UI speed multipliers only change how often callers advance the engine. Server wall-clock
plausibility accepts up to 3×, with the existing 10-second slack and prefix checks.

## Bread and waves

Ten pieces start in the pile, with tier `floor(i * (tierCount - 1) / 9)` and ascending
price order. Endpoint arrivals take the highest remaining tier and turn around.
Carriers travel toward spawn at 80% speed, also affected by ground slow. Arriving at
an empty pile still makes a pest return empty. Returning pests never collect drops.
Only a carrier exiting spawn loses bread. `bread` means **all not-lost pieces**;
`breadTiers` is the pile only, `dropped` holds rolling pieces, `carriedTiers` belongs
to each pest, and `lost` counts exited pieces. Their sum is always ten.

A killed carrier drops its entire stack at its current path position. Each piece
rolls toward the endpoint at `BREAD_ROLL_SPEED = 64` movement subunits/tick, then
rejoins the sorted pile. Movement uses 16 subunits per field unit. All arithmetic
and snapshots use integers. Failure occurs at ten lost pieces (or timeout). Passing
requires all five waves complete, no living pests, and ≥1 bread (including drops
still rolling home).

Wave five contains exactly one **大胃王鼠**: `kind: 'mouse', boss: true`, speed 20,
bounty 80. L1–L3 use armor 4 and HP `400 + 120 * (level - 1)`; later levels
use armor 8 and HP `600 + 180 * min(level - 1, 999)`. It takes up to three highest
remaining breads at once and drops the complete stack if killed.

`nextWave` is `{ index, counts: { ant, mouse, sparrow, beetle, boss } }`, or `null`
after wave five starts / game over. Boss is counted separately from ordinary mice.
`waveTargetTier` is the most expensive pile tier when the wave starts, or -1 if empty.
Waves auto-start after 600 prep ticks; calling early awards three coins per whole
remaining second. The next prep period starts when the current wave finishes spawning.

## Combat and drawing contract

The three maps use a 1440 × 810 landscape field, with rounded vertical serpentines entering
from the top-left, running down/up/down as they sweep left to right, and ending at an inset right-side plate. Each has eleven
spaced slots; every slot covers path within the shortest base tower range (150).
`TD_SLOT_RADIUS = 42` remains a 21 CSS-pixel radius at a 720-pixel-wide board.
Map rotation remains `floor((level - 1) / 4) % 3`.
Damage towers retain their previous tier stats. Sifters slow by 40% / 50% / 60% and
chip ground pests for 6 / 10 / 16 DPS, ignoring armor. Integer accumulation preserves
exact DPS without fractional HP. Tier 2 adds these branch effects:

| Tower | a | b |
| --- | --- | --- |
| Rolling pin | Two armored hits per attack | Push target 48 field units against its travel direction |
| Flour sifter | 65% ground slow, retained for 1 second after leaving the aura | 310-unit aura |
| Whisk | 140-unit splash | 24-tick attack interval |
| Oven | 16 damage every 30 ticks for 180 ticks; refreshes without stacking | 430 range and two extra targets in a 40-unit half-width, 150-unit continuation corridor |

Sparrows ignore flour auras. Only the strongest slow and chip rate apply, including overlapping auras and lingering
coating. Coating persists after selling the source too. Armor subtracts per
hit (minimum one damage). Stable targeting prefers greatest path distance, then
oldest pest ID; towers fire in slot order. Projectile stats are fixed at firing.

Pests expose `x`, `y`, `heading` (screen degrees, 0=right, 90=down), `hp`, `maxHp`,
`carrying`, `carriedTiers`, `slowed`, `returning`, and optional `boss: true`.
Towers expose `kind`, `tier`, `branch` (null before tier 2), `slot`, `target` (pest ID
or null), `cooldownProgress` (integer 0–100, 100=ready), `lastAttackTick` (null before
first shot), plus retained `level`, position, spend and ready-tick fields.

Drawing events include:

- `hit { pest, tower, damage, projectile }` (`tower` is its slot; burn/flour projectile is 0).
- `kill { pest, bounty, x, y }`.
- `pickup`, `drop`, `lose { pest, tiers, x, y }`; `recover { bread, tier, x, y }`.
- `place`, `upgrade { slot, tower, tier, branch }`, `sell { slot, refund }`.
- `waveStart { wave, targetTier, bonus }`, `bossSpawn { pest, wave }`, plus spawn/shot/over.

Every event also has `tick`. Events and nested arrays are detached from engine state.
`step` / `apply` return or expose only that operation's events; reading does not drain
or advance anything. Do not consume both returned and snapshot event batches.
Per tick: timeout, start/spawn, recover rolling bread, move/pickup/lose, flour chip damage, burn damage,
projectile impacts, tower attacks, clear check. Spawn exit beats damage on the same tick.

## Calibration and verification

`tests/support/tdBot.ts` uses public geometry/stats and a 2 Hz purchase cadence. It
scores damage coverage per coin, saves for the best next purchase instead of spending
every 60 coins on a cheap filler tower, chooses between both branches, values flour
chip DPS and nearby ground-tower support, and calls the next wave early only when no pests remain. Random purchases use
a deterministic independent RNG and choose branches too. Tuning uses 100 Monday seeds
starting 2026-01-05; a second disjoint regression window uses the following 100 Mondays.

L2 targets supersede D161/D162: greedy L1 100%, L3 approximately 90%, L5
approximately 75%, L10 approximately 50%, L20 approximately 20%; random L1 ≥30%.
Both 100-week windows must meet these targets (±10 percentage points except L1).
Random later-level wins no longer have a near-zero gate; ≥90% of greedy runs
must still build a sifter. The same public-information bot is used without strategy changes.

Measured v6 greedy passes (100 Mondays per window):

| Level | Window A | Window B | Target |
| --- | ---: | ---: | ---: |
| 1 | 100% | 100% | 100% |
| 3 | 88% | 93% | ≈90% |
| 5 | 78% | 76% | ≈75% |
| 10 | 45% | 43% | ≈50% |
| 20 | 17% | 22% | ≈20% |

Random L1 passes are 100% in both windows. All greedy checkpoint runs build a
sifter. Intermediate levels were also sampled in ten-week batches to remove
severe cliffs after map changes; individual weeks and map transitions need not
produce a strictly decreasing win rate. Splash-only play can now win favorable
late weeks, while pin-only, sifter-only and oven-only regression strategies still
fail the late mixed-wave checks.

Opening coins are 340 (previously 300), plus the existing temporary +100 combo
allowance centered on L10 and late +102/level ramp through L20. Ordinary L1–L3
pests award one extra coin. HP growth starts at 65 rather than 79; the early
mixed-swarm term is reduced from 454 to 300. Layout multipliers interpolate between
anchors in `level.ts`, accounting for different route lengths and firing windows.
The early boss is softer; tower statistics, five-wave curriculum, preparation,
bread recovery and authoritative replay rules remain intact.

## L2 vertical-S layout

All three boards are 1440 × 810. Routes enter the top edge at x ≤180, descend first,
then alternate direction across increasing x. Turns reach y=70/740 and use 70-unit
corner radii; map 3 has a tighter 55-unit lower turn between runs 3 and 4. Centerlines
are integer sampled arcs, shared literally by engine, Blender and overview SVGs.
Segment lengths are Euclidean, rounded once to movement subunits; position and
heading use the same segments, including diagonal turn tangents. Width is 74 units
with an 86-unit outer border throughout.

Slot centers are ≥126 apart and ≥103 from every centerline (60 beyond the border).
Slot rims retain ≥60 board clearance. The plate is 40 units back from the endpoint;
its 115-unit apron fits inside the board and all slot centers are ≥120 away.
Every slot reaches a route with the shortest base range (150). Every slot is in a
vertical gap, so long-range ovens cover both neighboring runs; map 3's narrower
gaps let even basic towers cover both. Wide map 1 teaches placing short-range
towers along one side of a gap and upgrading ovens for the opposite run.

| Map | Vertical x coordinates | Numbered slot roles | Plate |
| --- | --- | --- | --- |
| 1, Cooling rack | 180, 700, 1220 | 1–4 cover entry/return; 5 backs up the climb; 6–9 cover climb/final descent; 10–11 guard the final run, with 11 near the plate | (1220,650) |
| 2, Dough folds | 120, 510, 900, 1290 | 1–3 cover first gap; 4–6 cover middle gap; 7–9 cover last gap; 10–11 reinforce plate approach, with 10 nearest plate | (1290,160) |
| 3, Proofing walk | 100, 390, 680, 970, 1260 | 1–3, 4–6, 7–9 each cover two runs; 9 supports the tighter lower turn; 10–11 cover final gap and 11 guards plate approach | (1260,650) |

![Three vertical runs](../../../assets-src/td/map-1-overview.svg)
![Four vertical runs](../../../assets-src/td/map-2-overview.svg)
![Five vertical runs](../../../assets-src/td/map-3-overview.svg)

The five-level curriculum introduces ants, mice, mixed ants/mice, sparrows and
beetles in L1–L5. Sparrows follow the route but ignore flour slow/chip. Each level
uses demonstration, pressure, combinations, recovery, then a mixed boss finale.
Beetle armor starts at 6 in L5, rises by 10/level and caps at 54; HP remains 20% of
the ordinary species curve. Map rotation is still four levels per board.

## Offline checks

Run `npx tsc --noEmit`, `npm run lint`,
`npx vitest run --configLoader runner --project unit --maxWorkers 1`, and
`npx vitest run --configLoader runner --project db` against a validated `*_test`
database. Version tests cover seeds, saves, server rejection and e2e fixtures.
Geometry tests cover run count/direction, rounded vertices, spacing, coverage and
plate clearance; asset packing rejects stale coordinates or source hashes.
No browser is used and `src/components/**` / `src/app/game/**` are not edited.

Verified on 2026-11-01: TypeScript and ESLint pass. Both TD 100-week regression
windows pass. The full unit run has 1,179 passing tests and two unrelated failures
in the unchanged `tests/unit/m3Interactions.test.ts` (edge/short touch cases;
its board stub lacks `getBoundingClientRect`, also producing two unhandled errors).
No M3 UI files were changed. All 828 DB tests pass against `bunbunny_lvl2_test`;
the 10 TD integration/migration tests also pass after final tuning. Docker Blender
and packing validate all 25 atlases / 43 frames at 250,353 bytes; the decoded preview
was inspected offline. No browser or commit was used.

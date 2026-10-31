# 保卫大面包 — D5 engine v3

Pure deterministic TypeScript, shared by client saves and authoritative server replay.
No DOM, clock, photos, frame delta, or global randomness enters simulation. The server
continues deriving the weekly level from the same Monday and level number.

## Inputs, versions and saves

Canonical seed: `v3.td.<Monday YYYY-MM-DD>.<positive level>`. Version 2 runs and saves
are rejected. `TD_ENGINE_VERSION` also drives the existing save key and server gate.
Pass either `{ seed, tierCount }` or `{ level: tdLevel(week, n), tierCount }` to
`createTdGame`; descriptors are regenerated from their seed, never trusted.
`replayTd(options, inputs, endTick)` reconstructs the same detached snapshot.

Inputs have exact keys, safe integer ticks (0–18000), and slots 0–6:

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
matters. UI speed multipliers only change how often callers advance the engine.

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
armor 8, bounty 80, HP `600 + 180 * min(level - 1, 999)`. It takes up to three highest
remaining breads at once and drops the complete stack if killed.

`nextWave` is `{ index, counts: { ant, mouse, sparrow, beetle, boss } }`, or `null`
after wave five starts / game over. Boss is counted separately from ordinary mice.
`waveTargetTier` is the most expensive pile tier when the wave starts, or -1 if empty.
Waves auto-start after 600 prep ticks; calling early awards three coins per whole
remaining second. The next prep period starts when the current wave finishes spawning.

## Combat and drawing contract

The original three map polylines remain intact, each with seven spaced, useful slots
on both sides of the path. `TD_SLOT_RADIUS = 42` is the frontend draw radius (previously 30). Map rotation remains `floor((level - 1) / 4) % 3`.
Tiers 0 and 1 retain their previous tower stats. Tier 2 adds these branch effects:

| Tower | a | b |
| --- | --- | --- |
| Rolling pin | Two armored hits per attack | Push target 48 field units against its travel direction |
| Flour sifter | 65% ground slow | 310-unit aura |
| Whisk | 140-unit splash | 24-tick attack interval |
| Oven | 16 damage every 30 ticks for 180 ticks; refreshes without stacking | 430 range and two extra targets in a 40-unit half-width, 150-unit continuation corridor |

Sparrows ignore flour auras. Only the strongest aura applies. Armor subtracts per
hit (minimum one damage). Stable targeting prefers greatest path distance, then
oldest pest ID; towers fire in slot order. Projectile stats are fixed at firing.

Pests expose `x`, `y`, `heading` (screen degrees, 0=right, 90=down), `hp`, `maxHp`,
`carrying`, `carriedTiers`, `slowed`, `returning`, and optional `boss: true`.
Towers expose `kind`, `tier`, `branch` (null before tier 2), `slot`, `target` (pest ID
or null), `cooldownProgress` (integer 0–100, 100=ready), `lastAttackTick` (null before
first shot), plus retained `level`, position, spend and ready-tick fields.

Drawing events include:

- `hit { pest, tower, damage, projectile }` (`tower` is its slot; burn projectile is 0).
- `kill { pest, bounty, x, y }`.
- `pickup`, `drop`, `lose { pest, tiers, x, y }`; `recover { bread, tier, x, y }`.
- `place`, `upgrade { slot, tower, tier, branch }`, `sell { slot, refund }`.
- `waveStart { wave, targetTier, bonus }`, `bossSpawn { pest, wave }`, plus spawn/shot/over.

Every event also has `tick`. Events and nested arrays are detached from engine state.
`step` / `apply` return or expose only that operation's events; reading does not drain
or advance anything. Do not consume both returned and snapshot event batches.
Per tick: timeout, start/spawn, recover rolling bread, move/pickup/lose, burn damage,
projectile impacts, tower attacks, clear check. Spawn exit beats damage on the same tick.

## Calibration and verification

`tests/support/tdBot.ts` uses public geometry/stats and a 2 Hz purchase cadence. It
scores damage coverage per coin, chooses between both branches, supports ground
slow, and calls the next wave early only when no pests remain. Random purchases use
a deterministic independent RNG and choose branches too. Tuning uses 100 Monday seeds
starting 2026-01-05; held-out validation uses the following 100 Mondays.

Measured v3 passes (100 weeks per window):

| Level | Greedy tuning | Greedy held-out | Random tuning / held-out |
| --- | ---: | ---: | ---: |
| 1 | 100% | 100% | 100% / 100% |
| 10 | 52% | 51% | 0% / 0% |
| 20 | 11% | 13% | 0% / 0% |

The regression gates are ≥98%, 45–55%, and 10–15% respectively in **both**
windows. HP growth is `87 + floor(min(10, max(0, level - 10)) * 25 / 10)`;
normal pest HP uses that growth with level, wave and seeded weekly pressure. Opening
coins retain the D4 curve: 300 through L10, +102 per level through L20, then 1320.
Random L1 play remains deliberately forgiving; later levels reward tower choices.

Run `npx vitest run --configLoader runner --project unit`, `npx tsc --noEmit`,
`npm run lint`, and `npx vitest run --configLoader runner --project db` (only a
validated `*_test` database). E2E fixtures use the current seed and branch-aware bot;
no browser is required for this backend change.

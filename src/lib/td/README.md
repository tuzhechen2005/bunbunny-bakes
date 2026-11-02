# Deterministic bakery TD — D11 / engine v11

Canonical seed: `v11.td.<Gregorian Monday>.<level>`. Old v1–v10 unfinished runs
and saves are rejected; stored results remain intact. The save key derives from
`TD_ENGINE_VERSION`, so it changes to `bb_td_save_v11` without frontend edits.
60 integer ticks/s; travel uses 16 subunits per drawing unit. Board: 1440×810.
No clocks, global random state, account progression, or cross-week unlocks.

## Teaching combat and budgeting income

L1 starts with 75 coins: a 60-coin rolling pin plus 15 in reserve. Ants require
multiple hits, and a single never-upgraded pin should lose most weeks. Build a
second pin or upgrade early. The three-slot S route retains slow pests, ten
bread lives, no items, and no path mechanics. Slot coverage makes placement matter.

Every level budgets against the most expensive unlocked tower line: sum its
base, tier-1 and tier-2 purchase costs, then multiply by the number of slots.
Start coins plus all bounties plus the maximum four early-call bonuses must fit
within 75% of that full-build cost. The first wave call earns no bonus; each later
call can earn at most 30 coins (600 prep ticks). Bounties are proportionally
reduced and rounded down when necessary. This is computed from generated waves,
so count variation, species mix, unlocks and integer rounding cannot overrun the
budget. L1 weights rewards toward its opening wave to fund the next decision.
Finale bosses pay less, reducing coins awarded too late to invest.

The spending regression uses actual earned income, including call bonuses and
excluding escaped pests: because the greedy bot never sells, income equals
remaining coins plus tower investment. Every sampled L1–L30 run must invest at
least 70%. No bot policy changes are part of this balance revision.

D10's density and queue rules remain: ordinary counts are `round(D9 count × 0.6)`,
spawn intervals are `ceil(D9 interval / 0.6)` (L1 uses 167 ticks initially and 187 ticks after
the opening wave), and live caps are 8 below L20 and
12 thereafter, including bosses and returning thieves across overlapping waves.
Blocked arrivals wait without consuming their index; prep starts only after the
final actual arrival. The five-minute combat deadline is unchanged.

Snapshot week `2026-10-26`, each version's canonical seed. Ant HP is the
first-wave value; L2 contains mice only. Possible income includes all bounties
and the maximum 120 call-bonus coins, even if a particular run cannot earn all of it.

| Level | Start coins v10 → v11 | Ant HP v10 → v11 | Possible income v10 → v11 | Full-build cost |
|---|---:|---:|---:|---:|
| 1 | 340 → 75 | 28 → 350 | 1050 → 508 | 702 |
| 2 | 340 → 240 | — | 1273 → 505 | 702 |
| 3 | 340 → 340 | 420 → 552 | 1248 → 909 | 1248 |
| 4 | 340 → 340 | 512 → 515 | 1150 → 915 | 1248 |
| 5 | 340 → 340 | 325 → 342 | 1337 → 1248 | 1950 |

L8–L12 openings fund a useful initial combination rather than leaving most cash
waiting for a third tower. HP compensates for that investment; weekly HP pressure
is narrowed in this band to keep both disjoint checkpoint samples within target.
The L20 density multiplier is 110%, tapering from 86% at L10.

## Backend and renderer contract

`tdLevel(weekKey, number)` and `game.state()` expose `mapData`, `unlockedTowers`
and `newlyUnlocked` (an array containing this level's newly introduced tower,
otherwise empty). The start response exposes these fields too. Render `mapData`:
`path`, `slots`, and `features` are all geometry data. State map data is deeply
frozen; mutable simulation fields are detached snapshots. The legacy `map` index
and `TD_MAPS` remain only for old renderer compatibility; they are **not** the
simulation's map. No baked background is needed.

Slots: `min(11, 3 + floor((level-1)/2))`. L1–L10 have authored polylines with
explicit, separated off-path slots. L11+ uses seeded monotone columns,
varied heights and run counts, clear fork lanes, and bounded increasing feature
density. Slot generation accounts for both fork branches. Rendering coordinates
and travel distances are integer; segment lengths are quantized once.

| Level | New tower/item/path idea |
|---|---|
| 1 | Rolling pin; gentle short S; three slots; build or upgrade early |
| 2 | Flour bomb |
| 3 | Flour sifter |
| 4 | Speed strip |
| 5 | Whisk |
| 6 | Freeze bell |
| 7 | Seeded random fork |
| 8 | Oven |
| 9 | Player switch at fork |
| 10 | Butter slide |
| 11 | Freezer |
| 12 | Jam patch |
| 14 | Piping bag |
| 15 | Portal pair |
| 17 | Tunnel |
| 18 | Caramel torch |

No level introduces two new tower/item/path ideas. Slots grow independently.

## Path and combat rules

Feature `start/end` are main-path subunit distances, `geometry` is its drawable
polyline. A feature crossing a fork also has `geometries` for both lanes; draw
those instead of its single fallback `geometry`. Cream lines use the same rule. Fork `branches` rejoin at the same endpoints; `switchable` identifies
player-operated forks. Fork travel is scaled by actual branch length. Each pest
retains its seeded choice on its return trip and after knockback. A switch input
`{tick,type:"switch",fork:<feature id>}` toggles only subsequent entrants; it is
part of the replay log. `switches` exposes the current branch selection.

Portals jump from A to B outbound, B to A returning. Speed strips multiply speed
by 160/100, jam by 60/100; all multiplication truncates once. Tunnels prevent
new targeting and projectile impact targeting; existing burns continue.
Pest snapshots expose `inTunnel`, `onStrip`, `onJam`, `forkChoices`, `slipped`,
`frozenUntil`, `slowUntil` and `slowStrength` in addition to prior combat flags.

Each tower has base tier 0, tier 1, then mandatory tier-2 branch `a` or `b`.

| Tower | Base / tier 1 | Tier 2 a | Tier 2 b |
|---|---|---|---|
| Rolling pin | Single hits; every third hit stuns 24 ticks | Double strike | Knockback |
| Flour sifter | 238 base aura range (+40%); slow and vulnerability; grounds birds | Stronger slow/vulnerability | Wider aura |
| Whisk | Splash plus two-second slowing batter | Larger splash | Faster shots |
| Oven | Heavy hit and burn; death spreads fire to nearest living pest | Hotter burn | Longer range and pierce |
| Freezer | Radius freeze for 60 ticks every 240 ticks (tier 1 faster) | 120-tick cooldown | Wider radius |
| Piping bag | 180-tick cream line; crossing slips back 50 units once per line | Slip 100 units | 90-tick cooldown |
| Caramel torch | Continuous short-range 60-degree cone, damage every 6 ticks | Double damage | Longer cone |

Sifter slow persists after leaving/removing the aura, decaying linearly over
90 ticks (1.5 seconds); strongest aura wins. Grounding/vulnerability require
current aura membership. Cream-line snapshots contain drawing geometry and
branch membership. Bread dropped on a fork follows that branch back to the pile.

## Consumables and E1 integration

Pass trusted server inventory as `itemsAllowed: {bomb: count, bell: count,
slide: count}` in `TdOptions`; omitted means none. Each type may be used at most
once per level regardless of inventory count. No inventory is stored by this
engine. It enforces unlocks, coordinates, authorization and use limits.

- `{tick,type:"item",item:"bomb",x,y}`: L2+, radius 180, 400 damage (normal armor calculation).
- `{tick,type:"item",item:"bell"}`: L6+, stops every pest, including new spawns, for 180 ticks.
- `{tick,type:"item",item:"slide",position}`: L10+, canonical path subunit position;
  persists for the level, each pest slips back 120 units once.

`countItemUses(inputs)` is pure and returns `{bomb,bell,slide}`. Call it only on a
successfully verified replay log: replay rejects unauthorized, locked, duplicate,
or out-of-path item actions. `state.itemsUsed` and `verifyTdRun(..., complete,
itemsAllowed).itemsUsed` also expose verified counts. E1 must supply inventory
from trusted server state, bind it to the run, and deduct atomically at finish;
never accept inventory from the finish payload. The TD engine does not deduct inventory.

Build phase remains unlimited and inert. The first `callWave` starts combat with
no bonus; five waves, later early-call bonuses, 18,000 combat-tick limit, return
thieves, dropped bread, replay limits and exact input-key validation remain.

## L1–L10 ASCII overviews

`S` entry, `E` bread, digits slot indices (0-based), `>` speed strip, `/` and `\\`
fork lanes, `?` random fork, `X` switch. Coarse diagrams are generated from map
geometry; use actual coordinates for drawing and hit testing.

### L1 - Gentle S

```text







                       0         1
   S..............                      ................E
                 ...                  ...
                2  ...              ...
                     ................








```

### L2 - Bomb bowl

```text




   S...............
                  .
             0    .
                  .                   ..................E
                  .                   .
                  .                   .
                  .   1          2    .
                  .                   .
                  .                   .
                  .....................





```

### L3 - Flour corridor

```text



   S.......
          .                  ....................
          .                  .                  .
          .                  .   0         1    .
          .                  .                  .
          .                  .                  .
          .                  .                  .
          .                  .                  .
          .                  .                  .
          .    2       3     .                  .
          .                  .                  ........E
          ....................




```

### L4 - Fast straight

```text





   S.........>>>>>>....                 ................E
                      .                 .
                      .                 .
                 2    .                 .     1
                      .                 .
                      .                 .
                      .    0        3   .
                      .                 .
                      .                 .
                      ...................




```

### L5 - Whisk bend

```text



   S.........
            .              .................
            .              .               .
        0   >              .    2     3    .
            >              .               .
            >              .               .
            >              .               .
            .              .               .
            .              .               .   4
            .    1         .               .
            .              .               .
            ................               .............E




```

### L6 - Bell staircase

```text



   S..........>>
               >
          3    >
               .    0
               .                           .............E
               .............               .
                           .               .    2
                      4    .               .
                           .               .
                           .    1          .
                           .               .
                           .               .
                           .................



```

### L7 - Twin lanes

```text






        5

                    /////////////
   S.......>>>>>..?\\..........\\\...........
                     \\\\\\\\\\\            .
          2      3              4       0   .
                                            .   1
                                            .
                                            ............E




```

### L8 - Oven reach

```text



   S..../?
        /\\              ..................
       //.\              .                .
      // .\\         5   .    2      3    .
      >  . >             .                .
      >  . >             .                .
      >  . >             .                .
      >  . >             .                .
      >/ . >             .                .   4
       / .\\ 0       1   .                .
       //.\              .                .
        /\               .                ..............E
         \................



```

### L9 - Switch lesson

```text



                                            ............E
                                            .
                                            .
          2      3              4       0   .     1
                     ////////////           .
   S.......>>>>....X\...........\\\..........
                     \\\\\\\\\\\\
        5       6








```

### L10 - Butter return

```text




   S......./X\              ...................
           /.\              .                 .
       5  >/.\>          6  .    1       2    .
          > . >>            .                 .
          > .  >            .                 .
          > .  >            .                 .
          / .  \            .                 .
          / . \\            .                 .    4
          //.\\  3     0    .                 .
           /.\              .                 .
           /\\...............                 ..........E




```

## Regression evidence

The unchanged D9 checkpoint targets use two disjoint 20-week samples
(`tdBotWeeks(20, 0)` and offset 100), without purchased inventory: L5 85%,
L10 55%, L20 20%, each ±10 percentage points. L1 uses 100 weeks: greedy ≥95%,
single never-upgraded pin ≤20%, random 25–60%. Economy checks cover all levels
1–30 × 20 weeks. The density regression observes spawn ticks across 20 weeks at
each of L1–L25, L50, L100 and L1000. Queue/replay coverage verifies that blocked
arrivals cannot skip pests or start prep early. These are regression guardrails,
not estimates of human win rates.

Final v11 samples:

| Check | Week offset 0 | Week offset 100 |
|---|---:|---:|
| L5 greedy (20 weeks) | 80% | 95% |
| L10 greedy (20 weeks) | 65% | 45% |
| L20 greedy (20 weeks) | 30% | 10% |

L1 across 100 weeks: greedy **100%**, random **52%**, a single never-upgraded
pin rotating through the three slots **1%**. Two base pins (entrance slot 2,
then slot 0 as soon as affordable) and one entrance pin upgraded through tier 2a
both win **100/100**, retaining at least two bread. The first upgrade occurs
with at most two bread lost. These strategies buy during combat and use no items
or early-call bonuses.

Validation uses `--configLoader runner` because the shared `node_modules` link
cannot accept Vite's bundled-config temporary writes. Generate the local Prisma
client with `npx prisma generate` first when absent.

```sh
npx tsc --noEmit
npx eslint src tests --quiet
npx vitest run --configLoader runner --project unit tests/unit/td*.test.ts
TEST_DATABASE_URL=postgresql://bunbunny:bunbunny@localhost:5432/bunbunny_d11_test TEST_DIRECT_DATABASE_URL=postgresql://bunbunny:bunbunny@localhost:5432/bunbunny_d11_test npx vitest run --configLoader runner --project db
```

Final validation: TypeScript and ESLint pass. All 136 TD unit cases are verified
across the full sweep and final focused reruns, including 600 economy runs and
560 cap runs. All 890 DB cases are verified across the full DB suite and final
TD/migration rerun (13 tests), using only `bunbunny_d11_test`. The 100-map geometry
checks have a 30-second timeout to tolerate concurrent simulation load; their
assertions are unchanged. The e2e version and affordability assertions were
updated but browser e2e tests were not run.

No frontend component changes or commits are part of D11.

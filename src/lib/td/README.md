# Deterministic bakery TD — D10 / engine v10

Canonical seed: `v10.td.<Gregorian Monday>.<level>`. Old v1–v9 unfinished runs
and saves are rejected; stored results remain intact. The save key derives from
`TD_ENGINE_VERSION`, so it changes to `bb_td_save_v10` without frontend edits.
60 integer ticks/s; travel uses 16 subunits per drawing unit. Board: 1440×810.
No clocks, global random state, account progression, or cross-week unlocks.

## Fewer, stronger pests

Ordinary counts are `round(D9 count × 0.6)` at every level, including L1.
The original draws are consumed before thinning, retaining the species curriculum
and weekly variation. Each wave scales HP and bounty by its original/reduced
count ratio (approximately 1.67), with integer rounding. Bosses retain their
speed, armor and bread capacity, and receive the same count-ratio HP/bounty boost.
Ordinary HP additionally uses a smooth density correction: 100% at L1, 98% at
L2–L5, 86% at L10, and 115% at L20+, interpolating between checkpoints. This
compensates for changed splash value and firing windows while retaining D9's
win-rate curve. Speeds, armor, tower stats and opening coins are unchanged.

Across the first 20 sampled weeks, total pest counts (including bosses) are
60% of v9 at L1/L5/L10/L20. Total HP is respectively 107%/103%/91%/117% of v9;
total available bounty is 109%/104%/104%/103%. Thus lower density preserves the
aggregate economy and approximate threat, despite the seed-version change.

Spawn intervals grow to `ceil(D9 interval / 0.6)` (L1: 100 → 167 ticks).
Canonical waves set `maxLivePests`: 8 below L20, 12 from L20 onward, including
bosses and returning thieves across overlapping waves. When full, the next
arrival waits without consuming its index. It spawns after a space opens; the
following arrival waits the full interval. Prep time starts only after the final
actual arrival. This prevents slows, freezes and early wave calls from crowding
the road and remains deterministic in replay. Custom test fixtures may omit the
optional cap. The 18,000-tick combat deadline still applies.

Snapshot week: `2026-10-26`; each version uses its own canonical seed. Counts
exclude the single finale boss. HP entries are first-wave ordinary pests; boss
HP is from the finale. Other weeks/waves vary.

| Level | Ordinary pests W1/W2/W3/W4/W5, v9 → v10 | Ant HP | Mouse HP | Sparrow HP | Beetle HP | Boss HP |
|---|---|---:|---:|---:|---:|---:|
| 1 | 6/9/10/7/16 → 4/5/7/5/8 | 16 → 28 | — | — | — | 90 → 158 |
| 5 | 10/13/15/13/18 → 6/8/10/7/11 | 210 → 325 | 489 → 755 | 316 → 487 | 218 → 336 | 1320 → 2280 |
| 10 | 24/26/28/24/35 → 13/16/17/14/21 | 133 → 199 | 308 → 463 | 199 → 298 | 137 → 207 | 2220 → 3700 |
| 20 | 37/41/43/40/49 → 23/25/27/24/30 | 295 → 640 | 685 → 1486 | 442 → 960 | 305 → 663 | 4020 → 6700 |

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
| 1 | Rolling pin; gentle short S; three slots; one base pin at slot 0 wins |
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







   S..............                      ................E
                 ...   0         1    ...
                   ...              ...
               2     ................








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

The unchanged D9 targets use two disjoint 20-week samples (`tdBotWeeks(20, 0)`
and offset 100), without purchased inventory:

| Check | Target ±10 | First sample | Held-out sample |
|---|---:|---:|---:|
| L5 greedy | 85% | 75% | 75% |
| L10 greedy | 55% | 45% | 60% |
| L20 greedy | 20% | 30% | 25% |

L1 passes across 100 weeks with one unupgraded rolling pin, rotating through all
three slots. The density regression observes every tick across 20 weeks at each
of L1–L25, L50, L100 and L1000. A separate queue/replay regression checks that
blocked arrivals are neither skipped nor allowed to start the prep timer early.
Client, engine and DB regressions explicitly reject v9 saves/run seeds.
Small samples are regression guardrails, not estimates of human win rates.

Validation commands use `--configLoader runner` because the shared `node_modules`
link does not allow Vite's bundled-config temporary writes. Generate the local
Prisma client with `npx prisma generate` first when absent.

```sh
npx tsc --noEmit
npx eslint src tests --quiet
npx vitest run --configLoader runner --project unit tests/unit/td*.test.ts
TEST_DATABASE_URL=postgresql://bunbunny:bunbunny@localhost:5432/bunbunny_d10_test TEST_DIRECT_DATABASE_URL=postgresql://bunbunny:bunbunny@localhost:5432/bunbunny_d10_test npx vitest run --configLoader runner --project db
```

Final D10 checks: TypeScript and ESLint pass; all 11 TD unit files / 104 tests
pass, including all 560 density runs and all six unchanged D9 checkpoints.
The full DB suite passes 79 files / 890 tests on `bunbunny_d10_test`; the final
TD/migration rerun passes 2 files / 13 tests, including v8/v9 expiry coverage.
The tightened maximum-wave-size regression also passes its focused rerun.

No frontend component changes or commits are part of D10.

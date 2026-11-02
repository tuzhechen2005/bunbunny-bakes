# Deterministic bakery TD — D9 / engine v9

Canonical seed: `v9.td.<Gregorian Monday>.<level>`. Old v1–v8 unfinished runs
and saves are rejected; stored results remain intact. The save key derives from
`TD_ENGINE_VERSION`, so it changes to `bb_td_save_v9` without frontend edits.
60 integer ticks/s; travel uses 16 subunits per drawing unit. Board: 1440×810.
No clocks, global random state, account progression, or cross-week unlocks.

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
never accept inventory from the finish payload. D9 does not deduct inventory.

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

D9 uses two disjoint 20-week samples (`tdBotWeeks(20, 0)` and offset 100).
The greedy baseline has no purchased inventory; the bot accepts explicit
`itemsAllowed`, spends only on unlocked towers, switches toward better coverage,
places bombs at dense clusters, rings the bell against returning carriers, and
lays butter ahead of approaching pests. A separate inventory-enabled bot/replay
test verifies accepted uses and `countItemUses` accounting.

| Check | First sample | Held-out sample |
|---|---:|---:|
| L5 greedy | 85% | 95% |
| L10 greedy | 55% | 55% |
| L20 greedy | 25% | 25% |

L1: 100/100 weeks pass with one unupgraded rolling pin, rotating through all three
slots. Small samples are regression guardrails, not estimates of human win rates.
Opening coins are 340 through L5, taper to 210 at L10, then grow to 720 at L20.

Validation commands use `--configLoader runner` because this worktree's shared
`node_modules` link does not allow Vite's bundled-config temporary writes:

```sh
npx tsc --noEmit
npx eslint
npx vitest run --configLoader runner --no-cache --project unit --maxWorkers 1 --testTimeout 60000
TEST_DATABASE_URL=postgresql://bunbunny:bunbunny@localhost:5432/bunbunny_d9_test TEST_DIRECT_DATABASE_URL=postgresql://bunbunny:bunbunny@localhost:5432/bunbunny_d9_test npx vitest run --configLoader runner --no-cache --project db
```

Backend TypeScript passes. Full TypeScript still reports four frontend integration
errors in the deliberately untouched `TdBoard.tsx`, `tdRenderer.ts` and `tdInput.ts`:
three old four-tower exhaustive tables need the new tower keys, and input handling
must narrow to a build action before reading `slot`. The frontend must also draw
`state.mapData`, respect unlocks/slot count, and forward switch/item inputs.
No browser was launched and no commit was made.

Final D9 checks: the full non-tuning unit run passed 98 files / 1,209 tests;
subsequent focused regressions covered the final portal/freeze changes (27 tests),
and every difficulty checkpoint passed after the L10 coin adjustment. The full
DB run passed 72 files / 830 tests on `bunbunny_d9_test`, including trusted inventory
replay and old-v8 rejection. ESLint, isolated backend TypeScript and
`git diff --check` pass. The four full-TypeScript frontend errors above remain;
no type suppression or weakening was added to hide them.

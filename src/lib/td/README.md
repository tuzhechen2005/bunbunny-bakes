# Deterministic bakery TD — D181 / TD v12.1 / engine v13

Canonical seed: `v13.td.<Gregorian Monday>.<level>`. Old v1–v12 unfinished runs
and saves are rejected; stored results remain intact. The save key derives from
`TD_ENGINE_VERSION`, so it changes to `bb_td_save_v13` without frontend edits.
60 integer ticks/s; travel uses 16 subunits per drawing unit. Board: 1440×810.
No clocks, global random state, account progression, or cross-week unlocks.

## Teaching combat and budgeting income

L1 starts with 75 coins: a 60-coin rolling pin plus 15 in reserve. Ants require
multiple hits, and a single never-upgraded pin should lose most weeks. Build a
second pin or upgrade early. The three-slot S route retains slow pests, ten
bread lives, no items, and no path mechanics. Slot coverage makes placement matter.

Every level budgets against the most expensive unlocked tower line: sum its
base, tier-1 and tier-2 purchase costs, then multiply by the number of slots.
Start coins plus all bounties, the two 12-coin clutter rewards, and the maximum four early-call bonuses must fit
within 75% of that full-build cost. The first wave call earns no bonus; each later
call can earn at most 30 coins (600 prep ticks). Bounties are proportionally
reduced and rounded down when necessary. This is computed from generated waves,
so count variation, species mix, unlocks and integer rounding cannot overrun the
budget. L1 weights rewards toward its opening wave to fund the next decision.
Finale bosses pay less, reducing coins awarded too late to invest.

The spending regression uses actual earned income, including call bonuses and
excluding escaped pests: because the greedy bot never sells, income equals
remaining coins plus tower investment. Every sampled L1–L30 clear must invest at
least 70%. A swarm loss may instead retain less than one maximum tier-2 purchase
in cash (the bot can die just short of its saved upgrade). The default greedy
policy is unchanged; the separate responsive boss sample is described below.

D10's ordinary density and queue rules remain: ordinary counts are `round(D9 count × 0.6)`,
spawn intervals are `ceil(D9 interval / 0.6)` (L1 uses 167 ticks initially and 187 ticks after
the opening wave), and live caps are 8 below L20 and
12 thereafter for ordinary arrivals, including returning thieves across overlapping waves.
V12 swarm and boss-add exceptions use the global 16-pest ceiling documented below.
Blocked arrivals wait without consuming their index; prep starts only after the
final actual arrival. V12 replaces the five-minute deadline with a 72,000-tick replay safety bound; a clear resolves before this bound.

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
no bonus; five waves, later early-call bonuses, 72,000 combat-tick safety limit, return
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

## Historical v11 regression evidence

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
TEST_DATABASE_URL=postgresql://bunbunny:bunbunny@localhost:5432/bunbunny_td12_test TEST_DIRECT_DATABASE_URL=postgresql://bunbunny:bunbunny@localhost:5432/bunbunny_td12_test npx vitest run --configLoader runner --project db
```

Final validation: TypeScript and ESLint pass. All 136 TD unit cases are verified
across the full sweep and final focused reruns, including 600 economy runs and
560 cap runs. All 890 DB cases are verified across the full DB suite and final
TD/migration rerun (13 tests), using only `bunbunny_d11_test`. The 100-map geometry
checks have a 30-second timeout to tolerate concurrent simulation load; their
assertions are unchanged. The e2e version and affordability assertions were
updated but browser e2e tests were not run.

No frontend component changes or commits are part of D11.


## UI contract — D181 (owner 11/02)

No component or page changes are included. Integrate these engine/server additions:

- **Boss 大胃王鼠:** `boss: true`, `hp`, `maxHp` describe the three equal HP
  segments (boundaries `ceil(maxHp*2/3)` and `ceil(maxHp/3)`). `phase` is 0/1/2.
  The boss enters after preceding pests clear, with two escorts.
  Generated boss HP is 1.75× the previous formula through L17, **1.4× from L18**
  to budget for stronger adds without lengthening the full encounter. Speed stays 8 subunits/tick.
  `bossSpawn {tick,pest,wave}` is followed by two tiny mouse escorts. Each
  `bossPhase {tick,pest,phase,telegraphUntil,dashUntil,mice}` announces a phase
  (`mice: 5` at L1–L4, **6** from L5)
  at a health boundary. Draw a warning for 48 ticks (0.8 seconds); the boss stops
  and cannot take damage during this warning. Then it moves at 2× speed for
  24 ticks (0.4 seconds), subject to existing control effects. There is no death
  spawn. Snapshot timing fields let resume reconstruct the current warning/dash.
- **Burst protection:** `phaseReadyTick` exposes the next segment-break/kill
  eligibility. The first segment cannot break for six seconds after arrival;
  the second gets eight seconds and the last gets six seconds. Damage can lower HP to one above the
  next boundary during that window. Show the guarded segment while this applies;
  it prevents one volley from skipping response windows. No extra damage bonus.
- **Tiny mice:** `tiny: true` identifies the smaller render scale; `kind` remains
  `mouse`. From L5, each boss phase spits **6** mice: HP
  let `B=min(1500,320+36*(L-5)+40*max(0,L-10))`. At **L5–L17**, HP is `B`,
  speed **180 subunits/tick**, armor **50**. At **L18+**, HP is `floor(B*55/100)`
  (cap **825**), speed **240**, armor **55**. Bounty is **2** in both bands.
  Example HP: L5 **320**, L10 **500**, L18 **609**, L20 **693**. Faster late mice
  finish the return trip sooner; armor preserves pressure with less HP for splash.
  These are armored adds: use upgraded splash with overlapping flour; base attacks
  and low-damage torch branches are poor counters. No new damage-resistance rule.
  Arrival escorts and L1–L4 phase adds retain HP `42+min(80,2*(L-1))`, speed 64,
  armor/bounty 0; L1–L4 still spit five. Wave 3 from L5 contains 12–18 unarmored
  mice, 8 ticks apart, HP `min(200,60+6*L)`, speed **66**, base bounty 3 before
  income-budget scaling. Ordinary wave caps remain 8/12; all share a hard
  **16 total live pests**, including returners. Strong spits start at offsets
  **0/12/24/36/48/60 drawing units** along the route from the saved phase position,
  clamped at the endpoint. Blocked adds retain their individual offsets, wave,
  and inherited fork choices; an offset crossing a new fork uses the normal choice
  rule. The standard `spawn` event still identifies every actual arrival.
  Both spits' maximum **24 coins** are reserved in the 75% income cap.
- **Clutter:** `tdLevel`, start response, and `state.clutter` expose two objects:
  `{id,kind,x,y,hp,maxHp,reward}`; kinds are `flourSack`, `eggCrate`, `milkCan`.
  Render the fixed **12-coin** reward before targeting. HP is 216. A base pin
  breaks it in 209 ticks (3.48 seconds); combinations/upgrades can be faster.
  Send `{tick,type:"target-clutter",clutter:id}` (or `null` to cancel) through the
  normal replay log. `state.targetClutter` is the selected ID. In-range damage
  towers prioritize it using their normal damage/cooldown; support towers keep
  supporting. Attacks use `clutterHit {tick,clutter,slot,damage}`, followed by
  exactly one `clutterCleared {tick,clutter,reward}`. Animate these direct attacks;
  there are no pest projectiles for clutter. Broken objects remain at zero HP
  and selection clears. Build phase stays inert. No free tower rewards.
  The existing client's rejection-limit preflight must recognize this new action
  before its slot-based checks when the UI wires it up.
- **Stars:** `state.stars` is zero before a win or on loss; 8–10 bread = 3,
  4–7 = 2, 1–3 = 1. Finish returns `{stars,bestStars}` in addition to existing
  fields. Start, leaderboard (alongside `nextLevel`), and progress return
  `bestStars: Record<level,0|1|2|3>` for the current week and player (JSON keys are
  strings). No identity gives `{}` on leaderboard. Best stars aggregate verified
  finished attempts, case-insensitively; poorer retries and duplicate finishes
  cannot reduce them. Existing records have no invented stars. Apply migration
  `20261102181000_td_stars` before deploying the server.
- **Completion:** the former 300-second cutoff no longer ends active levels.
  Combat clears once all five waves, queued adds and living pests are resolved,
  even with dropped bread still returning. Only zero bread loses normally.
  A 1,200-second replay safety bound remains for pathological stalemates, with
  clearing given priority on its exact tick. The clock imports this bound.

### Historical V12 headless validation (superseded for current balance)

Reproduce the held-out sample with `npx tsx tests/support/td12Simulation.ts`.
It runs the existing public-state greedy bot over 20 weeks (offset 200) at
L1/L5/L10/L20, then replays the input log tick by tick for boss events and peak
population. Durations use simulation time, not 3× presentation speed. Phone
frame time is not measured by a Node simulation; 16 is an entity budget, not
proof of device frame rate. The older D9 pass-rate ceilings do not apply after
removing timeout losses and introducing the new swarm wave.

Final held-out sample (20 weeks per row, offset 200; boss times include arrival,
computed among killed bosses; losses before the boss are excluded from boss timing):

| Level / policy | Clears | Median level seconds | Median boss seconds | Peak live pests | Two-phase fights |
|---|---:|---:|---:|---:|---:|
| L1 greedy | 20/20 | 153.1 | 20.3 | 8 | 20/20 |
| L5 greedy | 16/20 | 168.0 | 22.0 | 16 | 16/16 |
| L10 greedy | 20/20 | 283.8 | 21.1 | 16 | 20/20 |
| L20 greedy | 11/20 | 307.6 | 53.4 | 16 | 11/11 |
| L20 responsive | 11/20 | 278.2 | 28.2 | 16 | 11/11 |

`npx tsx tests/support/td12Simulation.ts --responsive` uses the same greedy
policy until the boss is visible, then sells distant investment as needed and
puts a tier-2 double-strike pin and long-range/piercing oven in the two nearest
slots. It spends earned coins and records every sale/purchase/upgrade; a unit
test verifies the resulting complete replay. The reactive L20 fight is 26.7
seconds from first damage; the passive build is 46.9 seconds. This is a build
comparison, not a claim that every build meets the 20–30-second goal. In
particular, passive late-level builds can still take substantially longer.

Other validation:

- 600 comparisons (L1–L30 × 20 weeks) against the actual v11 generator give
  **1.60–1.915× boss HP**; the 1.75 multiplier leaves room for seeded count
  rounding. Week 2026-10-26 L1/L5/L10/L20: 525→840, 2160→3780, 3700→6475,
  6614→11886 HP.
- Greedy checkpoints at offsets 0 and 100: **L5 80%/80%, L10 100%/100%,
  L20 65%/65%**. These new ceilings reflect swarm composition and removal of
  timeout losses. L1 over 100 weeks: greedy 100%, random 51%, one never-upgraded
  pin 0%. Two base pins still clear all 100, but can retain only one bread;
  the upgraded entrance pin retains at least two.
- The 2026-10-26 L10 sample clears with **4 bread / 2 stars in 299.0 seconds**.
  A dedicated regression continues combat beyond 300 seconds and clears with
  bread remaining. A separate deadline regression still bounds pathological
  stalemates. 560 cap runs cover L1–L25, L50, L100 and L1000; the total stays ≤16.
- Clutter: one base pin takes 3.48 seconds, pays 12 once, and replays exactly.
  Snapshot mutation, exact action keys, two phase windows, dash movement,
  queued swarms, bread conservation and every star threshold are covered.
- TypeScript and ESLint pass. The full unit run had 1324 passing cases and
  three initial failures: a RUN timing timeout (all six RUN-track tests passed
  in isolation), the now-one-bread two-pin assertion, and the L5 loss while
  saving an unaffordable upgrade. Focused reruns pass after aligning the latter
  two assertions with v12. The hard 75% economy cap remains tested on every run;
  70% spending remains required for clears, while a loss may retain less than
  one maximum tier-2 purchase in cash. Further v12 and response-replay tests pass.
- All **916 database tests** pass, plus the final **14 TD/migration tests**,
  using `bunbunny_td12_test` (and the suite's suffixed `_test` scratch databases).
  No production database was used. Frontend rendering and phone frame time
  remain the UI/device validation work.


### V12.1 validation

The D181 amendment strengthens the spit and preserves its 6/8/6-second segment
guards. From L18, the boss HP multiplier falls from 1.75 to 1.4 so the complete
encounter, including add cleanup, stays near 20–30 seconds for the mixed reference. The suggested HP/speed alone produced zero spit losses even for
pin-only builds. The final tuning uses existing armor plus higher capped HP and
speed; a deliberate whisk/flour overlap is the tested counter. L1–L4 mice are unchanged.
Engine version 13 invalidates v12 unfinished runs and saves; it also changes the
weekly seed's generated layout/HP variation. Historical v12 rates above are not
current expectations.

Run `TD_SIM_OFFSET=300 npx tsx tests/support/td121Simulation.ts` for independent
validation weeks. It replays legal, earned-coin builds and attributes permanent
`lose` events to each phase's actual mouse IDs. Bread picked up and subsequently
recovered is not a leak. `single` is the upgraded rolling-pin-only bot; `mixed`
uses an upgraded opening pin, overlapping rapid whisk / strong flour, and at L18+
entrance oven coverage and a second whisk. `responsive` is the unchanged v12
pin/oven response policy, retained for comparison. No items or injected funds.
Full measurements and check results: [V12.1 validation](../../../docs/TD_V12_1_VALIDATION.md).

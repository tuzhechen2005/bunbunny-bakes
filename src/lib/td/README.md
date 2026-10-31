# 保卫大面包！ — D1 engine / D151 + D152

Original bakery tower defense, pure TypeScript shared by future client and server.
The only external engine dependency is `../game/rng.ts`. No clock, global randomness,
framework, DOM, owner photos, server code, or presentation speed enters simulation.
This task adds no route, page, persistence, leaderboard, or artwork. D151's unlock,
retry, weekly reset, and ranking rules remain responsibilities of the future server.

## API and replay

```ts
import { createTdGame, replayTd, tdLevel, type TdInput } from "@/lib/td";

// The existing week service supplies the Monday date in America/Chicago.
const level = tdLevel("2026-10-26", 1);
const options = { level, tierCount: 6 };
const game = createTdGame(options);
const inputs: TdInput[] = [
  { tick: 0, type: "place", slot: 0, tower: "rollingPin" },
  { tick: 0, type: "upgrade", slot: 0 },
  { tick: 0, type: "callWave", slot: -1 },
];
for (const input of inputs) game.apply(input);
const events = game.step(120);
const snapshot = game.state();
const restored = replayTd(options, inputs, 120); // Equal to snapshot, including events.

// A seed contains everything needed to reconstruct the numbered weekly level.
const sameGame = createTdGame({ seed: level.seed, tierCount: 6 });
const final = replayTd({ seed: level.seed, tierCount: 6 }, inputs);
// final.over, final.passed, final.bread, final.tick, etc.
```

- `TD_ENGINE_VERSION = 2`; canonical seed: `v2.td.<Monday YYYY-MM-DD>.<level>`.
  Old, unversioned, noncanonical, and unsupported versions are rejected. A real
  Gregorian Monday and positive safe-integer level are required. No per-player seed
  suffix exists: everyone receives the same five waves for the same week and level.
- Supply **either** `seed` **or** the descriptor returned by `tdLevel`. The engine
  regenerates the descriptor from its seed, so mutated waves, coins, or map fields
  cannot override the rules. The optional `tierCount` (1–100, default 6) must also be
  preserved alongside a replay. It never changes waves or combat difficulty.
- `step(toTick)` advances to an **absolute** tick at 60 ticks/second. Every intermediate
  tick is simulated. Invalid, backward, noninteger, unsafe, and >18,000 ticks throw.
  Simulation stops at the terminal tick; later forward steps return no events.
- `apply(input)` first validates shape/time, advances **through** the requested tick,
  then attempts the action. Thus endpoint theft, automatic waves, and terminal events
  at that tick occur before the input. Tick zero and multiple inputs at the same tick
  are valid; their array order is authoritative. Construction begins firing no earlier
  than the next tick. Speed 1×/2× belongs only to the future scheduler calling `step`.
- Exact input shapes are `{ tick, type: "place", slot, tower }`,
  `{ tick, type: "upgrade" | "sell", slot }`, and
  `{ tick, type: "callWave", slot: -1 }`. Build slots are indices 0–9. Extra keys,
  unknown types/towers, missing fields, and inappropriate tower fields are invalid.
- Invalid live inputs return `false` and increment `inputsRejected`. Malformed,
  backward, and over-cap inputs do not advance time. Legal-shaped but unaffordable,
  occupied-slot, empty-slot, max-upgrade, busy-wave, or terminal attempts also return
  `false` and count as rejected; their valid future time is advanced first. Successful
  actions increment `inputsAccepted`. No rejected action spends coins or builds.
- A game accepts at most 2,000 total input attempts. Clients validate transport shape and log well-formed attempts until 100 have been
  rejected. After that, preflight and silently ignore invalid taps without calling
  `apply`; valid actions still execute and are logged. This preserves identical
  replay counters below the server limit, including after save/resume.
  `replayTd` validates the **entire** array before simulation: exact shapes, nondecreasing
  ticks, observation bound, and input cap. It throws `TdReplayError` for malformed
  logs, inputs at/after termination, or >120 ignored gameplay inputs. A malformed live
  call is counted locally but cannot form a valid submitted replay. Seed/options
  errors throw `RangeError`.
- `replayTd(options, inputs, toTick = 18000)` returns the complete detached state.
  Empty/unfinished prefixes are supported for restoration. Its final operation is
  `step(toTick)`. Events describe that operation, not the entire replay history.
- `state()` is detached, consumes neither RNG nor events, and never advances time.
  It includes integer pest positions/progress/stats, towers/cooldowns/spend, moving
  projectiles, coins, bread count/tier indices, wave/target tier/scheduling, outcome,
  input counters, and events. Maps are separately exported as frozen `TD_MAPS`.
  Events contain primitive fields only and are detached in both snapshots and method
  returns. Consume either returned events or snapshot events, not both.
- Event batches depend on operation grouping. Concatenated chronological events and
  all non-event simulation fields match between single-tick and batched stepping.
  Comparing a bot's cleared event batch with a replay requires ignoring `events`.

Before ranked deployment, any change to physics, balance, maps, ordering, generation,
or RNG consumption requires incrementing this engine's version. Other games' versions
are independent.

## Geometry, bread, and combat ordering

The field is 720×1080. Each hand-authored, nonintersecting orthogonal polyline has ten
off-path slots (≥55 units from the path, ≥90 units between slot centres):

| Map | Arc length, field units | Used by levels |
| --- | ---: | --- |
| Cooling rack | 2740 | 1–4, 13–16, … |
| Dough folds | 2420 | 5–8, 17–20, … |
| Proofing walk | 2540 | 9–12, 21–24, … |

Map index is `floor((n - 1) / 4) % 3`. Movement distance/speed use **16 subunits per
field unit**. Drawing positions are truncated integer field units along that path;
subunit progress is retained at every corner. Squared distances implement inclusive
range/splash checks. No trigonometry, floating-point vector normalization, or frame
delta enters authoritative movement. Divisions explicitly floor/truncate to integers.

The pile starts with ten breads. Tier indices follow the owner's ascending price
order: bread `i` has tier `floor(i * (tierCount - 1) / 9)`, so both cheapest and most
expensive tiers appear even with >10 tiers. Each arrival removes **one** bread from the
front, regardless of pest kind/HP. A wave records the cheapest remaining tier when it
starts (`waveTargetTier`, also in its `wave` event); `steal` events identify the actual
lost tier. At zero bread the level fails immediately. Passing requires all five waves
to have spawned completely, no living pests, and at least one bread. Timeout fails.

Per tick, the order is:

1. Enforce the 18,000-tick / five-minute hard cap (expiry wins ties).
2. Auto-start a due wave, then spawn a due pest. The first pest spawns one tick after
   the wave starts; it moves that tick.
3. Evaluate flour auras at each pest's previous position, move along the path, and
   resolve theft. Arrival wins ties with projectile impact.
4. Move/resolve projectiles in creation order; immediately credit each kill exactly
   once and remove dead pests.
5. Fire ready towers in ascending slot order. Target greatest path progress within
   range, breaking ties by lowest pest ID. Finish if the last wave has cleared.

All damage towers can hit flying pests. **Sparrows follow the same winding path but
ignore flour slow entirely.** Ground pests receive only the strongest overlapping
slow, never stacked slow. Slow is recomputed each tick and movement is at least one
subunit/tick. Beetle armor subtracts six damage per hit, minimum one damage.

Shots capture their damage/splash stats when fired. They home to their target's current
position and take a fixed integer flight duration; leaving range does not cancel them.
If a target dies/escapes, a single-target shot expires harmlessly; a whisk splashes at
the last observed target position. Whisk splash affects every living pest in the
radius, with armor applied separately. Sold towers' existing shots remain live.
Upgrading retains the current cooldown and does not change shots already in flight.

## Economy and tuning constants

Start coins: **300** through L10; add **102 per level from L11 through L20**,
then cap at **1320**. The original pest curve continues growing after L20. Placement is tier 0; two upgrades produce tiers 1 and 2.
Upgrade costs are incremental, not total costs. Selling returns `floor(totalSpent/2)`.
No income comes from theft or time, and no interest or passive damage exists.

| Tower | Place / upgrade 1 / upgrade 2 | Damage 0 / 1 / 2 | Range 0 / 1 / 2 | Cooldown ticks 0 / 1 / 2 | Flight ticks |
| --- | --- | --- | --- | --- | ---: |
| Rolling pin | 60 / 75 / 99 | 18 / 31 / 52 | 165 / 180 / 195 | 26 / 23 / 20 | 6 |
| Flour sifter | 80 / 100 / 132 | 0 / 0 / 0 | 170 / 185 / 200 | continuous aura | — |
| Whisk | 100 / 125 / 165 | 22 / 38 / 63 | 150 / 165 / 180 | 48 / 43 / 38 | 10 |
| Oven | 150 / 187 / 247 | 95 / 166 / 275 | 300 / 315 / 330 | 110 / 99 / 88 | 24 |

Flour slows by 30% / 40% / 50%. Whisk splash radius is 85 units at every tier.
Upgrade formulas floor base cost ×125%/165%, damage ×175%/290%, and cooldown ×90%/80%;
each upgrade adds 15 range. The oven has the longest range and slowest fire rate.

| Pest | Unlock level | Base HP | Base speed, subunits/tick | Bounty | Armor |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ant | 1 | 28 | 48 | 8 | 0 |
| Mouse | 1 | 65 | 34 | 12 | 0 |
| Sparrow | 4 | 42 | 56 | 10 | 0 |
| Beetle | 8 | 145 | 23 | 18 | 6 |

For `d = min(n - 1, 999)` and zero-based wave `w = 0..4`:

- One seeded level pressure is uniformly chosen from 85..115 percent.
- Count: `min(96, 9 + d + 3*w + rng.int(3))`.
- Spawn interval: `max(18, 48 - floor(d/2) - 2*w)` ticks.
- HP: `floor(baseHP * (100 + 27*d + 12*w) * pressure / 10000)`.
- Speed: `floor(baseSpeed * (100 + min(150, 3*d)) / 100)` subunits/tick.
- Each wave starts with one of each unlocked kind, then chooses uniformly among the
  unlocked kinds. Bounty and armor stay constant. Difficulty saturation at L1000 and
  96 pests/wave bounds even hostile safe-integer level numbers to at most 480 pests.

Wave one auto-starts after 600 ticks. After the final spawn of waves 1–4, a 600-tick
countdown begins for the next wave, even while previous pests remain. `callWave` can
skip any such countdown, including the initial one: bonus =
`3 * floor(remainingCountdownTicks / 60)` (0–30 coins, at most 150 per level).
It is unavailable while a wave is still spawning and after wave five; repeated same-
tick calls cannot farm bonuses. Calling at the auto-start tick is already too late.
The difficulty curve varies at map changes; the three maps are intentionally distinct.

## Bot measurements and checks

`tests/support/tdBot.ts` contains both policies. Both observe at 2 Hz, use only public
geometry/stats/state, spend through `apply`, and call early only when the path is empty.
No policy reads upcoming waves or private RNG. The greedy policy chooses the affordable
placement/upgrade with greatest marginal coverage-weighted damage per coin, weights
earlier path coverage for earlier bounty income, estimates whisk crowd benefit and
oven overkill, and values one flour support tower near damage towers. The random policy
uniformly chooses among all affordable legal placements/upgrades, including sifters;
it never deliberately sells away its defense or submits invalid inputs.

The regression cohort is 100 consecutive Monday keys from 2026-01-05 to 2027-11-29.
An additional 100-week window from 2027-12-06 to 2029-10-29 (offset 100) checks
generalization. These are measurements
of these fixed policies, not estimates of human player success. L1 intentionally lets
even random purchasers succeed often; the policy gap is measured at L10.

Regression bounds: greedy L1 ≥98%, L10 35–65%, L20 10–15%; random L10 ≤15% and at least
20 percentage points below greedy. Random total passes across the three checkpoints
must be <75% of greedy total passes.

Measured with engine v2 and the included bot policy (2026-10-31):

| Level | Regression greedy | Regression random | Held-out greedy | Held-out random |
| --- | ---: | ---: | ---: | ---: |
| 1 | 100/100 (100%) | 97/100 (97%) | 100/100 (100%) | 100/100 (100%) |
| 10 | 46/100 (46%) | 0/100 (0%) | 44/100 (44%) | 0/100 (0%) |
| 20 | 11/100 (11%) | 11/100 (11%) | 12/100 (12%) | 8/100 (8%) |

Across both cohorts, greedy passes are **100% / 45% / 11.5%** at L1/L10/L20; random
passes are **98.5% / 0% / 9.5%**. Both 100-week cohorts run in the tuning regression.
Reproduce the held-out cohort with `tdBotWeeks(100, 100)`
and the same `greedyTd(tdLevel(week, n))` / `randomTd(...)` calls used in the tuning test.

Tests cover seeded/versioned generation, all map geometry, integer snapshots,
detached state/events/projectiles, economy and input rejection, capped replays and
malformed tails, same-tick actions, batched stepping/event equality, live/replay equality
across maps, scheduled/early waves, flight, splash, armor, slow immunity/nonstacking,
unique bounties, tier theft, terminal outcomes, and bot tuning.

```sh
npx tsc --noEmit --incremental false
npx eslint .
npx vitest run --configLoader runner --project unit --maxWorkers 2
```

Verification on 2026-10-31: TypeScript and repository-wide ESLint passed; all 87 unit
test files / 1,128 tests passed, including 16 TD tests. The worktree initially lacked
the ignored Prisma client; `npx prisma generate` restored it before the type check.
No database migration, browser, server/page integration, or art changes were needed.

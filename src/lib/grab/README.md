# GRAB v6 — 兔兔夹面包 (D183)

Pure, seeded TypeScript shared by client and server. Owner 11/02 decisions supersede the
review's recommendations to defer levels, mice and golden bread. No component/page changes
are included: Claude owns their presentation.

## API and replay

`createGrabGame({ seed, tiers })` requires at least three `{ id: string }` tiers; every tier
participates. `step(toTick)` advances a nondecreasing safe integer tick and returns detached
`GrabEvent[]`. `launch(tick)` advances then accepts only when idle; attempted launch ticks
must strictly increase. `state()` returns a fully detached snapshot. Read-only getters:
`score`, `over`, `grabs`, `launchesAccepted`, `launchesRejected`.

One tick = 1/60 second of active play. Busy inputs do not change aim or consume RNG.
A launch locks the current angle; extension begins next tick. Events belong to the latest
action; state reads don't consume them. Consume each action's batch once, including a
rejected launch that advanced time. Single-step and batched stepping produce identical
state and concatenated events.

`replayGrab(seed, tiers, launches, toTick = MAX_RUN_TICKS)` returns
`{ score, over, grabs, launchesAccepted, level, completedOrders }`. It checks array size,
strict safe integer launch ticks, observation bounds, no launch at/after expiry and at most
120 ignored busy inputs. Invalid logs throw `GrabReplayError`; invalid config throws
`RangeError`. Partial replay needs an explicit observation tick.

`GRAB_ENGINE_VERSION = 6`. Server seeds encode `v6`; unfinished v1–v5 runs and local saves
are rejected by existing version guards. Server reconstructs from issued seed, stored tier
snapshot, input log and end tick, never client points/level/order counts. Progress preserves
the input prefix and checks active time against elapsed wall time. Existing completed scores
remain historical; legacy GRAB rows without a level rank as level 1.

`MAX_RUN_TICKS = MAX_LAUNCHES = 36000`: a hard ten-minute active-time safety ceiling across
all levels and clocks, replacing v5's single-round natural bound. At either the level deadline
or safety ceiling, expiry precedes scoring/refills/movement. Held items earn nothing at expiry.
`step(Number.MAX_SAFE_INTEGER)` still finishes within the ceiling.

## Rules

- 720 × 1080 field; pivot `(360,0)`, oven `(680,80)`. Idle swing is a 300-tick triangle
  between −70° and +70°. Extension: 14 units/tick, empty return: 18.
- Integer swept-tip collision with photo radius +22, baked sine table, no runtime trig/sqrt.
  First contact wins; simultaneous contacts choose nearest centre to the ray, then array order.
- Bread S/M/L: radius 41/57/73, weight 1/2/3, base value 100/180/300. Contact ages <240
  are raw ×0.5, 240–540 perfect ×1.5, >540 burnt ×0.3. Field bread renews at age 601,
  retaining position, tier, size and special properties, with a new id; held bread stays frozen.
- Normal reel speed `ceil((17 - 4*weight)/0.8)`, floored at 5. Butter/clock: 22;
  S/M/L: 17/12/7; flour: 5. Integer rounding makes normal returns about 20–29% shorter
  than v5. Flour return is at most 228 ticks (3.8s) even using a conservative 1140-unit ray.
  Flour/butter pay 20. Clocks pay 0 and add 300 ticks on delivery, capped by the safety ceiling.
- Perfect chain: first/second/third+ perfect contact pays 100%/110%/120%, floor to integer.
  Chain state caps at 3. Raw/burnt/nonbread contact, bomb contact or an empty edge miss clears
  only the chain; it never deducts banked points. Existing bomb time penalties still apply.
- One two-item order: either duplicate tiers or two tiers (zero-based photo indexes).
  Each returned bread of any bake stage/special type fills one matching entry. Reward is
  300 = twice a standard small perfect grab, unaffected by chain. Delivery of the second
  ingredient banks the reward and immediately creates the next order. Orders and chain
  persist across level transitions.
- Required ingredients are reserved on the visible field immediately on new orders and
  rechecked each tick after removal/blasts/refills. Missing kinds reassign an unreserved bread
  (new id and raw age); if necessary convert an unreserved nonbomb item to small bread.
  This never draws extra deck cards or creates clocks. Duplicate requests reserve two items.
  If the field momentarily lacks enough nonbomb items, delayed refills supply them within
  30 ticks. This guarantees availability, not a free delivery or an unobstructed aim ray.
- A level passes immediately after delivery plus any order reward reaches its target.
  Next level begins on that tick, with the same field/order/chain, level score reset to zero
  and a fresh deadline. Surplus doesn't carry toward the next target. Total score is retained.

| Level | Target (this level) | Base seconds | Bomb population | Motion |
| --- | ---: | ---: | ---: | --- |
| 1 | 900 | 60 | 1 | stationary |
| 2 | 2000 | 54 | 1 | bread tray motion |
| 3 | 3100 | 48 | 2 | tray + mice |
| 4 | 4200 | 42 | 2 | tray + mice |
| 5 | 5300 | 36 | 3 | tray + mice |

Later levels add 1100 target points each; time falls 6s per level to a 20s floor; bombs cap
at 3. `grabLevelRules(level)` exports these rules. `level` means highest entered level,
including the current failed level, not completed level count.

Eight regular field items draw from shuffled 32-card batches (23 bread, 7 butter, 1 flour,
1 clock). Sizes/tiers/slots/jitter and specials use the seeded RNG. Slots are a 4×4 lattice,
centres x=90/270/450/630 and y=420/610/800/990, jitter ±14/±16. Initial items don't overlap.
Normal catches and blast victims refill after 30 ticks. The full future three-bomb population reserves enough outer
slots from level 1; bombs never use regular deck cards. Maximum population is eleven.

Bombs have radius 57, weight 0, no bread tier/stage. Contact emits `explode`, removes all
field items within centre distance ≤170, costs 300 ticks (floored at zero), clears the chain
and reels empty. Victims emit `pop`; bombs destroyed in a blast also respawn as bombs after
300 ticks. The triggering bomb has no `pop`. Held bread is not a blast victim.

From L2, regular bread drifts horizontally one unit every six ticks, reversing every 90 ticks
and clamped to bounds. From L3, each newly drawn nongolden bread has 1/5 chance to be carried
by a mouse: small bread, normal small weight, twice its bake value, moving ±1 unit/tick and
bouncing at field edges. A full-width crossing takes about 10.6s (about 15–30 screen px/s at
common phone board widths). Direction is exposed. Moving items may overlap; deterministic
first-contact rules still apply. Phone readability still needs Claude's rendering and a real
phone review; headless simulation does not establish it.

Golden bread: from L2, 1/64 chance per drawn bread, always medium, weight 12, reel speed 2,
three times its normal bake value (perfect 810 before chain). It cannot also be a mouse.
At equal distance and stage its value per travel tick is 0.8125× ordinary medium bread:
`3 * (1/14 + 1/12) / (1/14 + 1/2)`. It is an optional heavy choice, not a high-EV jackpot.
This comparison excludes waiting/aiming and order bonuses; it doesn't claim zero seed luck.

## UI contract

All item fields remain: `id, kind, tier, size, x, y, radius, weight, age, stage`. Specials keep
`kind: "bread"`; use optional `mouse`, `golden`, and `velocityX` to render the carrier,
gold treatment and facing. Don't infer these from tier or size. Poll logical positions for
motion; held position follows the claw, while stage/age stay frozen.

New state fields (available initially and on every snapshot):

| Field | Meaning |
| --- | --- |
| `pendingResult` | Null or `{ item, stage, points, chain, multiplierPercent }`, locked at contact until return; still visible if time expires while held. Points exclude the separate order reward. Show as pending, not banked. |
| `perfectChain` | 0–3 capped chain; `nextPerfectBonusPercent` is 0/10/20 for the next perfect contact. |
| `order` | `{ id, required: number[2], remaining: number[], reward }`; arrays preserve duplicate kinds. Tier indexes refer to the run's configured photos. |
| `completedOrders` | Total completed orders, including in the frozen result. |
| `level`, `levelScore`, `levelTarget` | Entered level, points earned toward its target, target. |
| `timeLeft` | Integer ticks left in the current level including clock bonuses. |

Existing fields: `tick, score, over, grabs, launchesAccepted, launchesRejected`, `items`,
`claw { phase, angle, length, x, y, held }`, and the latest `events` batch.

| Event | Fields | When emitted |
| --- | --- | --- |
| `contact` (new) | `tick, item` (id), `stage, points, chain, multiplierPercent` | On nonbomb contact, before `pop`; points are final but not banked. |
| `pop` | `tick, item` (snapshot) | Caught item or blast victim leaves the field. |
| `score` | `tick, item` (id), `points, bonusTicks` | At pivot; points exactly match contact result; only now banked. |
| `order` (new) | `tick, completed, reward, order` (new detached order) | On second ingredient delivery, after `score` and any ingredient-supply `refill` events. Reward is banked separately. |
| `level` (new) | `tick, level, target, duration` (ticks) | Immediately after a passing delivery/order and extra bomb refills. |
| `refill` | `tick, item` (snapshot), `from: {x,y}` | Scheduled spawn, bread refresh, order ingredient replacement or added level bomb. Render current `items` as authoritative; replacement can retire an id without `pop`. |
| `explode` | `tick, item` (bomb), `destroyed` (snapshots), `penaltyTicks` | At bomb contact, before victim pops. |
| `over` | `tick` | Expiry; no more scoring. |

Rendering should display contact stage/points immediately, refresh the order/level HUD on
state changes, and show `completedOrders`/`level` in the result. Extend any presentation-key
memoization for these fields. Preserve ids as render keys, and process motion from snapshots.
No UI assets or UI integration are delivered by this worktree.

Server finish response adds `level` and `completedOrders`; duplicate finishes reconstruct
orders from the first stored log, not the new request body. Progress saves the verified level.
Public leaderboard entries and `allTime`/`lastWinner` expose optional `level`; a personal row
also supplies `myLevel`. `score` stays the actual score. Admin rows expose `level` too.
Ranking, best-run deduplication, all-time leader, admin board and weekly prize selection use
level DESC, score DESC, then the existing timestamp/id tie-break. M3/TD ranking is unchanged.
No schema migration: GRAB uses the existing nullable `GameRun.level` column.

## Headless tuning

`npx tsx scripts/grab-tune.mts 100 8 review-1102-` runs random and aimed bots against identical
100 seeds. Bots inspect public state only; neither reads future spawns. Aimed play estimates
visible points per wait+travel time, including special multipliers, but does not optimize
orders or predict moving targets perfectly. These are strategy proxies, not human playtests.
See `docs/GRAB_V6_VALIDATION.md` for final numbers and checks.

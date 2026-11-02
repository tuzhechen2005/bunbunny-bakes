# D187 — TU difficulty diagnosis and validation (2026-11-02)

## Method

Run `npx tsx tests/support/d187TuSimulation.ts --compare`. It extracts only engine files
from `129f482^` (immediately before D184) and `129f482` (D184, same TU engine as task HEAD),
uses the **same current bot code** against each, and finally runs the working tree.
Temporary revision copies are removed afterwards; the checkout is never switched.

Each bot/revision runs 200 matched seeds `tune0`–`tune199`, eight bread kinds, to termination
with the full 20,000-input safety budget (not D184's censored 600-input sample).
Casual = `greedyTu`: prefer bag completions, accessible triples and orders, use rescue props.
Strategy = `diggerTu`: same rules plus prefer tiles uncovering visible lower tiles.
Neither uses the generator witness or hidden tier identities; peek reveals the full board
for one decision. Bots do not cash out: this measures survival/farming potential, not willingness
to stop. Quantile index = floor(N × p). Oven = oven reached at failure; all reported runs
terminated normally, none reached the input cap. These are bot proxies, not human playtests.
[Raw quantiles and full oven histograms](D187-simulation.json).

## Before / current / fixed

| Rules | Bot | Oven P10 / P50 / P90 / max | Score P10 / P50 / P90 / P99 | Max score |
| --- | --- | --- | --- | --- |
| pre-D184 v4 | Casual | 3 / 3 / 5 / 9 | 1,730 / 3,140 / 11,280 / 33,000 | 41,410 |
| pre-D184 v4 | Strategy | 3 / 5 / 15 / 41 | 2,390 / 11,940 / 121,690 / 665,830 | 859,750 |
| D184 v5 | Casual | 3 / 5 / 7 / 10 | 2,210 / 9,000 / 16,400 / 36,880 | 47,420 |
| D184 v5 | Strategy | 6 / 8 / 19 / 34 | 12,200 / 29,920 / 181,940 / 491,750 | 583,460 |
| D187 v6 | Casual | 3 / 4 / 5 / 7 | 2,210 / 4,760 / 9,850 / 18,850 | 20,000 |
| D187 v6 | Strategy | 4 / 5 / 8 / 10 | 4,090 / 10,200 / 23,200 / 32,380 | 40,470 |

**Both curve and scoring are responsible.** D184 removed the oven-3 cliff: casual median
moves 3→5 and strategy 5→8; strategy reaches oven 10+ in 82/200 v5 runs, versus 56/200
before. The late layout repeats indefinitely (apart from the 20,000-input guard), rather
than increasing difficulty. The samples do not prove infinite survival, but do demonstrate
long tails; two-kind shops cannot fill the bag and hit the old input cap by construction.

The unchanged v4/v5 pack/order/clear rewards all multiply by the oven number. Once the
layout stops growing, score per oven still grows linearly, producing approximately quadratic
cumulative score in long runs. The extreme tail predates D184: the pre-D184 sample maximum
is actually higher, so attributing every 300k run to D184 would be wrong. D184 chiefly makes
entry into that tail easier. Cash-out ends play and pays props once; these simulations never
cash out and still exceed 300k. Props are capped at six, so the largest possible ending prop
bonus at v5's observed maximum oven 34 is 10,200, not hundreds of thousands. There is no
repeated cash-out bonus explanation for the observed inflation.

## Final rules

Oven 3 remains 54 tiles / 6 layers / 6 kinds instead of the old 96-tile cliff. Ovens 4–8:
84/108/132/156/180 tiles; 8/10/12/14/16 layers; 7/8/8/8/8 kinds; spread 4.
Initial hidden share across 100 `hid` seeds is 8/28/43/55/60/65/68/71% for ovens 1–8.
Ovens 9–12 reuse the final layout; clearing 12 ends the run without dealing oven 13.
The terminal tap emits its normal pack/clear rewards followed by one bonus and over;
`batch` remains 12, tiles and bag are empty, `canStop` is false.

Casual ends at ovens 3–4 in 115/200 (57.5%); strategy at 5–6 in 114/200 (57%).
There is still a skill tail: 21/200 strategy runs reach oven 8+, but none reaches 11.
Solvability construction is unchanged: spread ≤4 and no witness move fills the six-slot bag.

Pack/order/clear multipliers flatten at ×5. Unused props retain ×ending/cleared oven to
match the existing component's cash-out preview; the finite 12-oven run bounds this bonus
at 3,600. Cash-out still consumes one log entry, pays once and disallows further actions.
Even assuming **every pack fills an order**, all ovens clear and six props remain:

`sum(oven=1..12, (tiles[oven]/3 × 40 + 100) × min(oven,5)) + 6 × 50 × 12 = 102,920`.

Thus 300k is impossible under v6, including small-kind shops and perfect witness play.
This is a stricter bound than merely reserving 300k for exceptional play.

## Version and leaderboard

D189 supersedes the initial invalidation policy: new starts use v6; live v5 seeds
retain v5 rules for progress, finish and engine resume. Versions before v5 stay rejected.
Client save-key retention still needs Claude’s component wiring (see the engine README). E2E uses a neutral fixture seed
and a dynamic save key, so no literal version pin needed changing. Its former 20k-input
end scenario now verifies the finite final oven and result reopening.

The actual shared leaderboard queries **do not filter TU by version**. Weekly best,
all-time and personal records retain old eligible scores, including previously verified
progress. No automatic reset happens this week. Live v5 unfinished runs can submit more
progress and finish; finished retries return the original stored result. D187 records
this explicitly and a DB regression checks a v5 300k result remains above a v6 10k result.
No leaderboard, award, or deletion policy is changed.

## Validation

- TU unit plus `smallD184` tests: 83 tests, including 11,200 witness oven clears across
  all eight configurations (500 eight-kind seeds; 150 seeds for each shop size 2–7),
  terminal 12-oven witnesses for two/eight kinds, capped scoring, late cash-out, replay,
  event score conservation, fixed vectors and 200-seed difficulty bounds.
- TU DB, TU admin DB, shared game progress DB: 52 tests.
- `npx tsc --noEmit`; `npx eslint src tests --quiet`; `git diff --check`.
- E2E expectations updated; browser tests are not claimed run.
- Prisma client was missing locally; ran `npx prisma generate` before successful DB/type checks.
- All DB connections used `postgresql://bunbunny:bunbunny@localhost:5432/bunbunny_small_test`.
  Applied existing migrations directly with DATABASE_URL and DIRECT_URL set to that URL.
  Used a temporary copy of `vitest.config.mts` with `globalSetup: []` to bypass the default
  setup's `/postgres` maintenance connection. Both TEST_DATABASE_URL and
  TEST_DIRECT_DATABASE_URL were set to the requested test URL. Temporary config removed.
- Only engine, tests, simulation support and documentation changed; no components; uncommitted.


## D189 follow-up validation

- `npx tsc --noEmit`: passed.
- `npx eslint .`: no errors; existing unused `hasForks` warning in TD renderer.
- TU unit tests: 7 files / 81 tests passed, including recorded v5 replay and serialized resume.
- TU DB tests: 2 files / 46 tests passed against `bunbunny_small_test`, including v5
  progress/finish, obsolete-version rejection and unchanged historical ranking.
- Recorded independently with HEAD v5 engine/deal: 13 ovens, then cash-out, 87,030 points.
- No `src/components/**` edits; localStorage v5 discovery/retention remains the UI handoff.

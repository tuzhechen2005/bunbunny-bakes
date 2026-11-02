# D184 validation — owner 11/02

Scope: M3/TU/BIG engine, server, tests and docs; no components or app pages changed.
Branch `codex/small1102`. Raw final measurements: [D184-simulations.json](D184-simulations.json).

## M3

100 independent Chicago Monday keys, 2026-01-05 through 2027-11-29, each tested directly
at all 30 levels (3,000 final-configuration attempts). Same `greedyM3` visible immediate-score
strategy and seeded ties as the review; no lookahead into refills or generated witnesses.
Measurements were accumulated over calibration rounds; only results for the final rules
appear in the JSON. Reproduce the complete final curve and its acceptance assertion:

```sh
npx tsx tests/support/d184M3Simulation.ts 100
```

Final rates, L1–L30:
98, 98, 99, 92, 100, 97, 88, 89, 75, 82, 67, 69, 55, 53, 63,
55, 50, 48, 42, 27, 18, 19, 10, 7, 6, 6, 5, 9, 2, 2 percent.
Maximum adjacent decline: **15 percentage points**. L6→L7: **97→88%**;
L18→L19: **48→42%**. Recovery is included, not just the introduction levels.
L1 random legal-move bot: 67/100 passes, successful runs use 64.5% of allowed moves.

The initial +2 moves / 30% discount candidate still gave L7 80% and L19 17%; a +4-move
L19 candidate reached only 26%. To satisfy the requested pass-rate boundary without changing
refill/scoring, final extra-move schedules are:

- L7–L14: +3,+3,+3,+3,+2,+2,+1,+1.
- L19–L30: +6,+6,+5,+5,+4,+4,+3,+3,+2,+2,+1,+1.

For each introduction: 30% target discount for two levels, then 20% for two, 10% for two,
then the original target curve. This is deliberately more relief than the initial +2 suggestion,
justified by the measured failure of smaller buffers. Maximum allowance is 15, below the
engine's 30-move cap. Infinite later levels recover the original bounded rules.

All generated levels still require a concrete winning witness. Unit tests replay independent
witnesses, validate event score conservation, fork metadata, and exact terminal gaps.
Pass-rate calibration is a finite bot sample, not a claim about human pass rates.

## TU

Final ovens: 24/36/54/72/90/96/108/120 tiles; kinds 4/5/6/6/7/8/8/8;
layers 2/4/6/6/6/8/8/8; spread 2/3/3/3/3/4/4/4. Last configuration repeats.
Solvability tests replay all eight configured ovens for 500 eight-kind seeds plus 150 seeds
for each shop size 2–7: **11,200 oven clears**, without props. Layout and bag invariants also pass.

Reproduce the review-seed strategy sample:

```sh
npx tsx tests/support/d184TuSimulation.ts
```

100 seeds `review-1102-0..99`, eight kinds, 600-input cutoff, only visible tiles except
one decision after spending peek. Counts are end-of-run; censored runs are separate.

| Strategy | Median inputs | Median oven | Censored at 600 |
| --- | ---: | ---: | ---: |
| Random legal | 9 | 1 | 0 |
| Greedy + props | 253 | 5 | 0 |
| Digger + props | 597 | 8 | 49 |

Greedy reached/failed per oven 1–8: 100/2, 98/4, 94/25, 69/16, 53/21, 32/22, 10/8, 2/2.
**The review's aspirational “adjacent failure fraction does not double” target is not met**:
oven 2 has 4/98 failures, oven 3 has 25/94. The board-size jump is reduced, but six kinds
and six layers remain a meaningful step. Trial spread 2 at oven 3 yielded 24/94 failures;
spread 1 plus spread 2 at oven 4 yielded 23/94 and two censored greedy runs. Neither
fixed that threshold; the final spread-3 candidate retains the simpler curve and no greedy
censoring. No solvability or human-difficulty claim is inferred from these bot failures.

Cash-out is available after the first 24-tile clear and every later clear, independent of
how long a stronger bot would continue. Tests cover legal/illegal boundaries, invalid taps,
closing the window on props/taps, replayed score, repeated stop, and server idempotency.

## BIG

```sh
npx tsx tests/support/d184BigSimulation.ts
```

100 same-payload seed pairs, greedy drops every 180 steps (1.5 seconds), up to 600 drops.
Versioned and fixture seeds produce **100/100 identical scores and physics hashes**.
Highest/next tier state and optional `drop`/`merge.milestone` metadata do not change rules.
Legacy 32-hex production seeds fail engine reconstruction; server finish/progress reject
old unfinished versions. Existing finished results remain idempotent.

## UI handoff

- M3: read settled `lastCascadeWaves` before scheduling the existing wave events;
  read `failureGap` after failure. Orders are bonus opportunities, not pass conditions.
- TU: offer 收工 at `canStop`, call `stop()`, append `{ id: STOP_TILE_ID, at }`, and route
  that reserved id to `stop()` during client restore. `tuPlanning` gives pairs/prop previews.
- BIG: display `highestTier`/`nextTier`, consume optional existing-event `milestone`;
  update save cleanup to use `BIG_ENGINE_VERSION` and handle expired-seed reconstruction.
- These are engine contracts for Claude's UI work; this branch does not implement animations,
  buttons, save-parser UX, customer interviews, or claim browser/mobile validation.

## Checks

- `npx tsc --noEmit`: passed (generated the missing Prisma client locally first).
- `npx eslint src tests --quiet`: passed.
- Related unit suite: **19 files / 183 tests passed**, using two workers and a 30s default
  timeout during concurrent simulations. Includes all M3/TU unit files and BIG engine tests.
- Related database coverage: **6 files / 119 tests passed**. `game.test.ts` (52) and
  `tu.test.ts` (32) completed in the broad run; the remaining four files (35 tests) completed
  in a separate targeted run: `m3.test.ts`, `m3.admin.test.ts`, `tu.admin.test.ts`,
  `game.progress.test.ts`. Cash-out persistence/idempotency, obsolete versions, replay,
  leaderboards and progress-prefix validation all passed.
- Broad unit invocation was stopped after **1,277 passes and 2 unrelated failures**:
  `levelDesign.test.ts` expects a TD mouse with hp 90 but gets hp 525;
  `runTrack.test.ts`'s 1,000-seed path check exceeded its explicit 15s timeout (17.7s).
  Both files and their engines are unchanged here. Remaining long TD calibrations were
  interrupted; **the complete unit suite is not claimed green or fully executed**.
- Broad database invocation was stopped after **412 passes, no failures**, then relevant
  files were completed as above. The remaining unrelated business/migration tests were
  not completed in that invocation; **the complete database suite is not claimed complete**.
- Related unit command: `npx vitest run --project unit tests/unit/m3* tests/unit/tu*
  tests/unit/gameEngine.test.ts tests/unit/gameReplay.test.ts tests/unit/smallD184.test.ts
  --maxWorkers=2 --testTimeout=30000`. Database final targeted command uses
  `npx vitest run --project db` with the four remaining file paths above.
- `git diff --check`: passed. Changes remain uncommitted because git metadata is read-only.
- Every database invocation explicitly sets both test URLs to
  `postgresql://bunbunny:bunbunny@localhost:5432/bunbunny_small_test`.
  Database setup and migration-test maintenance URLs are unchanged.

# TD v12.1 validation — D181 amendment, 2026-11-02

Engine **13**. Engine/tests/docs only; no component files changed.

## Final balance

- L1–L4 phase mice and both arrival escorts retain their previous stats/counts.
- From L5: six mice per spit, 12 drawing units apart, bounty 2 each. Both spits'
  potential 24 coins are reserved in the existing 75% full-build income cap.
- Define `B=min(1500,320+36*(L-5)+40*max(0,L-10))`. L5–L17 use HP B,
  speed 180, armor 50. L18+ use HP `floor(B*55/100)`, speed 240, armor 55.
  HP examples: L5 320, L10 500, L18 609, L20 693; the late cap is 825.
- Swarms remain 12–18 mice / 8 ticks apart, with HP `min(200,60+6*L)`,
  speed 66, armor 0. Base bounty remains 3 before income scaling.
- Boss HP uses the previous formula multiplied by 1.75 through L17 and 1.4 from
  L18. The 6/8/6-second segment guards, telegraph, dash and hard 16-pest cap remain.
  The late HP tradeoff and faster adds keep the **whole encounter** near 20–30 seconds.

The suggested HP/speed starting point still yielded zero pin-only spit losses in
20-week L5/L10/L20 trials. Simply inflating unarmored HP punished mixed builds too.
Existing armor plus deliberate splash/flour overlap produced the intended pressure
without a new damage mechanic. Base attacks and low-damage torch branches are poor
counters to these armored mice; upgrades matter.

## Independent validation

20 weeks per level/policy, offset 300 (2031-10-06 through 2032-02-16).
Tuning used offset 200. Reproduce with:

```sh
TD_SIM_OFFSET=300 npx tsx tests/support/td121Simulation.ts
```

`single` buys/upgrades rolling pins only. `mixed` upgrades an opening pin, places
whisk/flour for overlapping coverage, upgrades them, and adds entrance oven coverage
and a second whisk from L18. Both use public geometry, legal purchases, earned coins,
no items, and the same purchase cadence. Neither receives injected funds. The mixed
policy is a deliberate reference build, not a claim about all mixed builds.
The older `responsive` pin/oven policy is retained separately in the raw results.

Each input log is replayed. Permanent `lose` events are attributed to the actual
mouse IDs from each `bossPhase`; pickups followed by recovery are not leaks.
All primary-reference rows reached and killed the boss, giving 40 spits per row.
A clear only requires bread remaining; 100% clears does not mean no leaks.
Medians use the upper middle observation. Times are simulation seconds, not UI speed.

| Level | Clears, single / mixed | Mean bread lost per spit, single / mixed | Median loss, single / mixed | Mixed spits stopped completely |
|---|---|---|---|---|
| L1 | 100% / 100% | 0 / 0 | 0 / 0 | 40/40 |
| L2 | 100% / 100% | 0 / 0 | 0 / 0 | 40/40 |
| L3 | 100% / 100% | 0 / 0 | 0 / 0 | 40/40 |
| L4 | 100% / 100% | 0 / 0 | 0 / 0 | 40/40 |
| L5 | 100% / 100% | 1.6 / 0 | 2 / 0 | 40/40 |
| L10 | 100% / 100% | 1.7 / 0.275 | 2 / 0 | 37/40 |
| L20 | 100% / 100% | 1 / 0.5 | 1 / 0 | 28/40 |

Pin-only spits lose 1–3 bread in **100% / 90% / 60%** of L5/L10/L20 observations.
Mixed builds stop **100% / 92.5% / 70%** completely. This is a typical-build result,
not a guarantee: some mixed L10/L20 spits still leak, at most four bread in this
sample. L20 remains sensitive to terrain and placement.

| Level | Single: boss death / full encounter | Mixed: boss death / full encounter |
|---|---|---|
| L1 | 20.25s / 23.67s | 20.25s / 23.67s |
| L2 | 20.05s / 20.05s | 20.05s / 20.05s |
| L3 | 28.52s / 28.52s | 28.52s / 28.52s |
| L4 | 22.72s / 22.72s | 22.72s / 22.72s |
| L5 | 20.10s / 24.60s | 20.10s / 22.92s |
| L10 | 22.77s / 25.95s | 21.10s / 24.95s |
| L20 | 28.18s / 31.73s | 24.25s / 28.72s |

Boss death runs from `bossSpawn` to its `kill`. Full encounter includes all remaining
adds, through level completion. Mixed full-encounter medians are **22.92 / 24.95 /
28.72 seconds** at L5/L10/L20; pin-only L20 takes 31.73 seconds.
[Raw results and exact week keys](TD_V12_1_RESULTS.json) include the historical
responsive policy, boss-kill counts, engagement times and complete leak histograms.

The unchanged generic greedy bot is less reliable than the deliberate mixed policy.
Its clears at offsets 0 / 100 (20 weeks each) are L5 **60% / 35%**, L10 **100% / 95%**,
and L20 **60% / 50%**. Expectations reflect stronger spits rather than silently
changing that bot. L1 over 100 weeks remains: greedy **100%**, random **60%**, one
never-upgraded pin **0%**. Both existing two-pin and early-upgrade teaching builds
clear all 100 weeks. L1–L4 independent reference clears are all 100%.

## Verification

The requested TypeScript, ESLint, TD unit and TD database commands are used. Database
checks use only `postgresql://bunbunny:bunbunny@localhost:5432/bunbunny_td12_test`.
The suite retains its `_test` guard. Version tests explicitly reject unfinished v12
seeds and saves; the client key is `bb_td_save_v13`.

Unit coverage includes exact stats/counts, spacing, queued arrivals under the cap,
fork entry choices, canonical replay, economy reservation, mild swarms, onboarding,
old-save rejection, and a pin-only versus mixed combat regression. The phase timing
fixture gives escaping mice a longer test-only road so bread exhaustion cannot
terminate it before the timing assertions.

All requested checks passed:

| Check | Result |
|---|---|
| `npx tsc --noEmit` | Pass |
| `npx eslint src tests --quiet` | Pass |
| TD unit tests plus `levelDesign` | Pass — 175 distinct cases covered by the full run and final affected-case reruns |
| TD database + TD migration tests | Pass — 14 cases, only the configured `_test` database and its `_td_test` scratch database |
| `git diff --check` | Pass |

The full unit run passed 170 cases before the final late-level adjustment. Final
reruns passed all 107 then-current non-tuning cases and all 26 affected late tuning
cases; the unchanged 41 early tuning cases were already covered. The added final
L20 behavior case also passed (three behavior cases total), giving 175 distinct
current cases. Both revised curve expectations were rechecked. No required test
was removed or skipped from the combined coverage.

Reproduce all current unit cases in one invocation with:

```sh
npx vitest run --project unit tests/unit/td tests/unit/levelDesign.test.ts --maxWorkers=2
TEST_DATABASE_URL=postgresql://bunbunny:bunbunny@localhost:5432/bunbunny_td12_test npx vitest run --project db tests/db/td.test.ts tests/db/migration.td.test.ts
```

No commits were created; all requested changes remain in the worktree.

# GRAB v6 validation — D183, owner 11/02

Command: `npx tsx scripts/grab-tune.mts 100 8 review-1102-`.
100 paired seeds (`review-1102-0` … `review-1102-99`), eight bread tiers, 200 complete runs.
Bots use current public snapshots, without future refills or RNG access. These are tuning
proxies; phone readability and typical human performance remain to be tested in the UI.

| Mean metric | Random | Aimed |
| --- | ---: | ---: |
| Level entered | 2.55 | 3.87 |
| Score | 3712.55 | 9137.68 |
| Completed orders | 2.02 | 7.19 |
| Active seconds | 80.33 | 106.48 |
| Delivered grabs | 22.43 | 36.12 |
| Accepted launches | 54.29 | 39.14 |
| Fraction of time claw busy | 89.14% | 63.28% |
| Longest continuous busy interval (mean seconds) | 3.176 | 4.084 |

- Both bots passed L1 in 100/100 seeds.
- Random ending levels: L2 46, L3 53, L4 1.
- Aimed ending levels: L3 24, L4 65, L5 11. All 100 end in the desired L3–5 band.
- Aimed mean score is 2.461× random. These are paired strategy comparisons, not causal
  estimates of player skill or predictions of retention.
- Review v5 aimed busy fraction was 67.4%; this corpus gives 63.28%. Different rules and
  a longer multilevel session mean the scores/session lengths aren't direct like-for-like
  improvements. The review's longest-busy statistic was a median; ours is a mean.
- Flour return speed 5 units/tick: even a conservative 1140-unit ray returns in 228 ticks,
  3.8 seconds. Normal return speed uses `ceil(oldSpeed / .8)`; integer rounding gives
  approximately 20–29% less return time.
- Golden medium bread has 3× stage value and speed 2 versus ordinary medium speed 12.
  At the same distance, travel-time-normalized value ratio is 0.8125. Perfect base value
  is 810, or 972 at capped chain. Rarity is 1/64 per bread drawn from L2; no golden L1.
  This bounds the economic appeal of lucky spawns, but doesn't prove zero weekly seed luck.
- Mice begin with L3 refills, speed 1 field unit/tick, crossing about 638 units in 10.6s.
  Render width 180–360 pixels implies 15–30 pixels/s. Real phone presentation is unverified.

Regression coverage includes live/batched/replay equivalence, contact lock and delayed bank,
chain cap/reset, order duplicates and replacement, level transitions, special value rules,
expiry/no held-item credit, bounds/ids, bomb populations/respawns, old-version rejection,
server progress and duplicate finishes, and level-first ranking with case-insensitive best-run
selection. Existing M3/TD SQL paths retain their prior ranking semantics.

Checks and any baseline failures are recorded below after the final test runs.

- `npx tsc --noEmit`: passed (generated the missing Prisma client first).
- `npx eslint src tests --quiet`: passed.
- `git diff --check`: passed.
- Final GRAB unit sweep with `--maxWorkers=1`: **48/48 passed**, seven files.
  Full-run replay median **8.18ms**, maximum **14.48ms** over seven measurements, retaining
  the 50ms assertion. Multilevel fixture-generation tests allow 30s for setup; this does not
  relax the replay measurement threshold.
- The unrestricted full unit sweep surfaced failures in untouched TD/RUN/TU files and
  contention-sensitive fixture timeouts. Separate single-worker reruns confirmed:
  `tests/unit/levelDesign.test.ts:33` expects TD boss HP 90 but the unchanged engine yields
  525; `tests/unit/runEngine.test.ts:139` measured a 145.96ms replay median against 100ms.
  No TD/RUN/TU source or tests were changed in this task.
- No `src/components/**` or app page edits. UI integration and phone visual testing remain
  with Claude; the engine state/events/API contract is ready for that work.
- Worktree `codex-grab6`, branch `codex/grab6`; changes remain uncommitted because git
  metadata is read-only in this session.
- Full database sweep: **916/916 tests passed**, **82/82 files**, 1056s. Every DB test
  invocation explicitly set both `TEST_DATABASE_URL` and `TEST_DIRECT_DATABASE_URL` to
  `postgresql://bunbunny:bunbunny@localhost:5432/bunbunny_grab6_test`. Global setup and
  migration maintenance URLs were not changed. This includes the new level-first ranking
  fixture and existing cross-game/admin/prize/progress/version/concurrent-finish coverage.
- After confirming the unrelated failures, the broad unit sweep's remaining long TD
  simulations were canceled through session control (exit 130); it is **not** reported
  as a passing full unit suite. The final GRAB-only suite is complete and passing.

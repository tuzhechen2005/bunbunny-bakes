# S5 / D136 implementation and verification — 2026-10-30

Implemented for BIG, TU and M3. No commit or deployment was made.

## Behavior

- Each game has a `POST .../progress` accepting `{ runId, log }`. The full log is replayed from scratch through the same verification function as finish. No incremental replay/cache was introduced.
- An atomic per-run 8-second attempt reservation runs before fetching the stored log or validating/replaying the submitted entries. Invalid attempts also consume the interval. Concurrent progress cannot overwrite a finish or a newer claimed report.
- Verified unfinished scores join the weekly ranking, hub, owner board/award selection and the existing idempotent weekly winner job. Expired verified unfinished runs survive cleanup. Week boundaries remain America/Chicago, including the November DST reset.
- All three clients report every 10 seconds and flush on hidden/pagehide/in-page exit. Existing finish submissions handle game over. Requests are silent, bounded by a timeout, and retry on the next tick; pending exits retain the latest snapshot. Large TU logs exceed the browser keepalive budget, so those exit requests use ordinary fetch and delivery on browser shutdown remains best effort.
- Visible boards/hub refresh every 15 seconds and show the palette-based live badge for unfinished scores verified within 30 seconds. The four intervals live in `src/lib/liveScores.ts`.
- Runtime `LIVE_SCORES=off` immediately returns 404 before reading progress bodies or touching the DB; clients disable all progress reporting after the first 404. Boards receive the switch, disable polling/live badges and use finished-only ranking. Finish remains available.
- Additive migration `20261030210000_game_live_scores` adds nullable `updatedAt` and `progressAttemptAt`; the existing score and evidence columns store the last verified result. Apply this migration before deployment.

## Checks

| Check | Result |
| --- | --- |
| `npx vitest run --configLoader runner --project unit` | 68 files, 994 tests passed |
| `TEST_DATABASE_URL=postgresql://bunbunny:bunbunny@localhost:5432/bunbunny_s5_test npx vitest run --configLoader runner --project db` | 63 files, 795 tests passed |
| Final progress-path rerun after avoiding full-log reads on 429 | 8 DB tests passed |
| Client scheduling/hook targeted rerun | 6 tests passed |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed |
| `npm run fonts` | Passed; generated font files unchanged |
| `git diff --check` | Passed |

The default `bunbunny_test` had a pre-existing failed migration. Tests instead used the isolated `bunbunny_s5_test`; no non-test database was used and the original failed migration was not modified.

`tests/e2e/live-scores.spec.ts` adds four browser scenarios: all three games' reporting/exit/hidden/404/board polling, plus hub polling/kill switch. Execution was attempted. Turbopack hit the sandbox's FSEvent restriction; a temporary webpack server started successfully, but Chromium then failed before any page assertion with macOS `MachPortRendezvousServer: Permission denied (1100)`. Browser assertions therefore remain unverified in this environment. The temporary server was stopped. Hook-level tests exercise visibility, pagehide, unmount, finish suppression, full TU payloads, retries and cross-game 404 suppression.

## Replay measurements

`tests/unit/liveReplay.bench.test.ts` benchmarks schema parsing plus the actual server replay/plausibility verifier, excluding DB/network I/O, with one warmup and seven measured samples. BIG uses default production physics and the longest of 20 fixed greedy-bot seeds. TU uses a valid two-tier run that reaches the 20,000-entry cap. These are local-machine samples, not a deployment latency guarantee.

| Fixture | Isolated median | Isolated maximum | Full concurrent suite median | Full concurrent suite maximum |
| --- | ---: | ---: | ---: | ---: |
| BIG: 384 drops, 23,010 simulation steps | 10.49 ms | 11.55 ms | 25.77 ms | 50.05 ms |
| TU: 20,000 valid entries | 78.88 ms | 86.43 ms | 208.19 ms | 219.94 ms |

No sampled BIG replay exceeded 200 ms. Reporting intervals remain unchanged. TU timing is sensitive to concurrent CPU load; its full-suite numbers are included for the orchestrator's deployment assessment.

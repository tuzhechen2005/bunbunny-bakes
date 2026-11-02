# Run engine — v10 / D182

Pure deterministic TypeScript shared by live play and server replay. All geometry
uses integer millimetres; time is 60 Hz ticks. `RUN_ENGINE_VERSION = 10` rejects
unfinished v1–v9 runs and version-derived local saves. Finished scores remain.
Scope: engine/server/tests/docs only; Claude owns the components and pages.

## UI contract

`createRunGame({seed, realtime?})` exposes `input(tick, dir)`, `step(toTick)`,
`state()` (detached), and `frame(toTick)` (borrowed; do not retain). Input advances
**through** its tick before applying the action; a collision-tick swipe is too late.
Log all valid inputs, including no-ops, at strictly increasing ticks. The limits
remain 20,000 inputs and 54,000 ticks, including practice. Server `replayRun`
uses `captureEvents: false` to skip feedback allocation; scoring and control state
are identical to live event capture (covered by parity tests). `L/R/U/D` mean lane left,
lane right, jump, slide. **`S` skips practice** at that tick; elsewhere it is a no-op.

### Starting and handing over

`POST /api/game/run/start` accepts `{wechatId, nickname, startMode?}` where
`startMode` is `normal` (default), `sprint`, or `practice`. It returns
`{runId, seed, expiresAt, startMode}`. Server checks case-insensitive RUN finished
history: sprint requires a finished run; practice requires no finished run.
There is no history/best-distance value trusted from the browser. Modes are stored
in the immutable run seed (`v10.<randomhex>[.sprint|.practice]`), so progress and
finish replay use the stored mode automatically. No schema migration is needed.
Choose normal to decline practice or sprint; after starting practice, log `S` to
skip the remainder. This is a run setting, not a persistent upgrade.

State fields:

| Field | Meaning |
| --- | --- |
| `startMode` | Original server-selected mode; does not change on skip |
| `phase` | `practice`, `sprint`, or `running` |
| `controlTick` | Sprint handover or practice end tick; updated to skip tick by `S`; normal is 0 |
| `distance` | Ranked millimetres; zero throughout practice |
| `bread` | Raw bread value collected (gold counts 5), independent of points |
| `breadPoints` | Accumulated bread points after combo multiplication |
| `combo` | `{streak, level:1|2|3, graceAvailable}` |
| `death` | Null until fatal hit, then `{id, kind, lane, reasonCode}` |

Sprint is invincible and ignores swipes until exactly **400,000 mm**. It collects
no bread or powers. Its distance counts normally (400 points at handover). It uses
the same acceleration for everyone and clamps the final automatic tick to exactly
400m. The engine removes objects from the start and the **400–464m** safety buffer,
including conservative moving-obstacle envelopes. Trucks/rollers still start no
earlier than 480m. A `takeover-warning` is emitted exactly 120 ticks before control.
The UI may fast-forward rendering, but must retain simulation ticks and the existing
server wall-time plausibility check; it cannot instantly claim free elapsed time.

Practice lasts **720 ticks / 12s** unless skipped. At 3s a central cart asks for a
lane change; at 7s flour across all lanes asks for a jump; at 11s awnings across all
lanes ask for a slide. Hits are harmless, and no practice score, distance, bread or
powers enter ranked play. At completion/skip the player resets to the centre,
actions clear, ranked distance resets, and the ordinary seeded track and speed
curve begin at zero. Practice time still counts toward the 15-minute run cap.

Events are returned by `step`/`input` and exposed in `state.events` for the latest
operation. `state()` does not drain them. A large step can return multiple events.

| Event | Fields beyond `type` | When |
| --- | --- | --- |
| `takeover-warning` | `tick, controlTick` | Exactly 2s before sprint ends; show 接管 countdown |
| `control` | `tick` | Sprint ends, practice ends, or practice is skipped |
| `practice-cue` | `tick, action` | Ticks 1/241/481: `change-lane` / `jump` / `slide` |
| `combo` | `tick, streak, level, graceAvailable` | Each bread pickup, forgiven miss, reset or hit |
| `near-miss` | `tick, id, kind, lane` | Once on safely exiting a close obstacle; show 好险, **no score** |
| `death` | `tick, hit` | Fatal hit; `hit` has the same fields as state `death` |
| `collision` | `tick, id, kind, lane` | Shield absorption or fatal hit; resets combo in either case |
| `over` | `tick, reason` | Existing `collision` or `limit`; `death` is null for limit |
| `action` | `tick, dir` | Accepted motion; skipped/ignored input need not emit this |
| `collect` | `tick, id, kind, lane` | Bread or power pickup |
| `expire` | `tick, kind` | Power expiry |

Death hints: cart/van/truck → `change-lane`; awning → `slide`;
flour/puddle/pothole/bread-wheel → `jump`. IDs let the UI highlight the fatal
object. Near-miss means a completed same-lane clearance: under an awning, over a
pothole, or with feet less than 600mm above another low obstacle during overlap.
Roof travel, coffee bypass and absorbed hits do not emit it. It never changes score.

Objects expose `id, kind, lane, z, front, back, height, speed, signalUntil,
targetLane`, plus optional `y, value, carrierId`. `z` is relative to player; objects
sort by z then ID. **`comboId` and `comboStep:1|2`** link the two obstacles of a
designed phrase for advance highlighting. Both are visible within the ordinary
90m window; they do not reveal hidden future track. Truck signals last 60 ticks,
then change to the adjacent target lane; carrier bread moves with its truck.
Detached and pooled snapshots expose the same fields.

Player fields remain `y, surface, lane, pose, progress, laneChange, queuedLane,
shield`. Lane changes last 12 ticks (occupancy switches halfway), allow one queued
swipe, and overlap jump/slide. Jump/slide last 42/36 ticks. Powers: coffee 360 ticks
at ×1.5 speed and collision immunity; magnet 480 ticks; shoes 480 ticks allowing
one extra airborne jump; shield absorbs one obstacle without stacking. Full
collision dimensions and jump/roof physics remain in `geometry.json`.

## Scoring

Distance multiplier remains ×1 below 500m, ×2 from 500m, ×3 from 1500m:

```
score = floor(distance / 1000) * distanceMultiplier + breadPoints
```

Each collected bread object increments streak once, including gold. Bread 3 and
onwards earn ×2, bread 6 and onwards ×3: `10 * (value ?? 1) * combo.level`.
Existing points are never multiplied retroactively. One missed bread object per
chain consumes grace without clearing streak; another miss resets streak/level
and replenishes grace. Collection does not replenish grace. Any hit, including
shield absorption, resets the chain. Misses count when a bread centre passes the
player uncollected (including optional side/roof bread), in deterministic object
order. Coffee bypass is not a hit. Sprint/practice cannot build a chain.

## Speed, spacing and simulations

Owner 11/02 explicitly requested acceleration despite the earlier review's advice.
For ranked elapsed tick `t` (practice excluded):

```
speed(t) = 480 + floor(240 * min(t, 1200) / 1200) mm/tick
coffeeSpeed(t) = floor(speed(t) * 1.5)
```

| Ranked time | Speed mm/tick | Metres/second |
| --- | ---: | ---: |
| 0s | 480 | 28.8 |
| 5s | 540 | 32.4 |
| 10s | 600 | 36.0 |
| 15s | 660 | 39.6 |
| 16.67s | 680 (old cap) | 40.8 |
| 20s+ | 720 | 43.2 |

Old curve: 480→680 over 35s. New cap +5.88%; maximum coffee speed 1080.
Rows widen 60→64m, preserving 3-row phrases. First obstacle is 94m. Awning→pothole
widens 26→28m; flour→cart retains 18m. Combo IDs make both steps telegraphable.
Roof and action density thresholds remain 1260m and 2340m. Normal moving trucks
and wheels remain restricted to middle rows and cannot invade the reserved route.

Worst-case introductory two-lane crossing gap is 61.4m, above
`1080 * (30 reaction + 24 crossing + 1 margin) = 59.4m`. Roof→truck recovery
is 28m, above `1080 * (10 + 12 + 1) = 24.84m`. Combo→ramp recovery is
20.8m, above the concurrent one-lane move's 14.04m; its next route is visible
before finishing the jump. A 28m slide→jump gap preserves action timing at coffee
cap. These bounds are also exercised by the existing seeded path tests.

Headless public-snapshot bots, unchanged 250ms latency, `tuning0..99`, 300s cap:

| Controller | N | p10 seconds | Median | p90 | Capped |
| --- | ---: | ---: | ---: | ---: | ---: |
| Casual (250ms) | 100 | 10.70 | 17.28 | 20.73 | 0 |
| Intermediate (250ms) | 100 | 36.62 | **69.20** | 116.62 | 0 |
| Search (no latency) | 20 | 300 | 300 | 300 | 20 |

Search had zero collisions, including shield absorption. Delayed intermediate
median meets the requested 60–90s range; this is bot evidence, not a phone playtest
or a claim that every player will survive that long. Harness: `tests/support/runBot.ts`; reproduce summary with `npx tsx tests/support/runV10Simulation.ts`.

## Verification

Run `npx prisma generate`, `npx tsc --noEmit`, `npx eslint src tests --quiet`,
and unit plus DB Vitest projects. All DB runs must set both `TEST_DATABASE_URL`
and `TEST_DIRECT_DATABASE_URL` to
`postgresql://bunbunny:bunbunny@localhost:5432/bunbunny_run10_test`.
Do not modify global setup or migration maintenance URLs. UI implementation and
browser/WeChat playtesting are separate work.

### v10 validation record (11/02)

- TypeScript, ESLint and diff whitespace checks pass. Final targeted functional
  suite: **48/48** (six files), including start modes, event-free replay parity,
  combo/grace, near miss, death, old-save rejection and maximum-speed combo timing.
- 1,000 early real-engine paths pass after raising that workload's timeout to 60s
  on the shared host. The 1,000-seed spacing assertions and 100 mature five-minute
  searches also completed without route/collision failures. Sample counts and
  physical assertions were retained.
- The broad unit sweep excluding `tdTuning.test.ts` ran 1,258 cases: 1,252 passed
  initially. Subsequent focused runs resolve the obsolete speed expectation,
  event-free test loaded against an earlier engine during the sweep, and early
  path timeout. The two **100ms replay performance assertions pass** on the final
  isolated run after the other suites finished (20,000-input median and full
  15-minute replay). Earlier concurrent runs exceeded the budget, as did
  unmodified HEAD on the same loaded host. The 100ms budget was not relaxed.
- The unrelated TD `levelDesign` assertion expects boss HP 90 but gets 525.
  Full-suite TD tuning was interrupted; it is not reported as passing. No TD
  source or tests were changed.
- Browser/e2e was not run; its RUN seed fixture was bumped to v10. UI components
  and pages remain unchanged and need Claude's integration of the contract above.

- Non-migration DB suite: **902 cases verified passing** on `bunbunny_run10_test`.
  The thread-pool sweep passed 901 and failed the native timezone-switch assertion;
  a final fork-pool run passed all **23** RUN/date cases (11 RUN, 12 date), including
  sprint eligibility, stored-mode replay, practice skip and immutable log prefixes.
  The original full DB run was interrupted during migration tests; migration
  verification is **incomplete**, and maintenance URLs/global setup were untouched.

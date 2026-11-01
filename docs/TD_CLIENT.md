# TD server and client (D2 / D151, D152, D154, D155)

`/game/td` is the sixth game. D4 upgrades D1's engine to v2 with the calibrated opening economy (D156). The server reuses `gameLevels.ts` from `codex/m3lv`.
D3 art is optional; no browser was used during implementation.

## Server contract

- `POST /api/game/td/start`: `{wechatId,nickname,level?}`. The default is the next
  level for that literal, case-insensitive identity this Chicago week. N requires a
  verified pass of N−1 in the same week. Failed attempts can always be retried.
- Start returns `{runId,seed,level,weekKey,tiers,expiresAt}`. `tdLevel(weekKey,n)` is
  deterministic for everyone. `tiers` are the owner's TierView photos, excluding
  the synthetic BIG logo. Linked products sort by unit price ascending; unlinked
  game pieces retain owner order before priced breads. The exact tier snapshot is
  retained on the run; later product/image/price edits cannot alter that attempt.
- `POST /finish`: `{runId,inputs,endTick}`. Inputs are exact D1 actions with simulation
  ticks. The server derives the level from the stored start week and number, checks
  the canonical versioned seed, and replays from scratch. End time must match the
  exact terminal tick. Client scores and outcome flags have no authority.
- `POST /progress`: `{runId,log,endTick}`. Uses shared D136 throttling, kill switch,
  canonical prefix and monotonic time checks. It stores the current wave as internal
  live score but never sets `passedAt` or unlocks anything. Activity can appear beside
  the player's previous passed level. Finish preserves previously verified evidence.
- `GET /leaderboard`: shared level ranking, highest passed level then earliest server
  pass time, shared bans/hidden scores, masked identities, crown, and `nextLevel`.
  Admin `?game=td`, awards and winner mail also use passed levels.

TD accepts 2,000 inputs and at most 18,000 combat ticks after the first manual
`callWave` (D168, engine v8). Building before `startedTick` is unlimited; snapshots
expose `awaitingStart`, and the first call gives no bonus. Absolute observation
ticks may exceed 18,000; wall time and monotonic progress still include building. Wall-clock plausibility
allows the supported 2× scheduler plus shared slack. Pauses do not consume ticks.
A sustained median gap below 120 ms (at least ten actions), or hitting the input cap,
sets suspicious without excluding the score; a few same-tick purchases are legitimate.
Finished submissions are idempotent and concurrent finishes claim the result once.

## Canvas and controls

The field is the engine's 720×1080 map, fitted without distortion into the remaining
portrait viewport. Header, HUD, wave target photo and controls fit 320/390×700; the
play shell uses `100dvh` and safe-area padding. DPR is capped at two. Map art includes
the path; otherwise the renderer draws the engine polyline and slots once onto a
cached static canvas. Tier photo crops are cached too. Dynamic sprites use ground
anchors and frame rectangles. The rAF draw function creates no objects, arrays,
strings, gradients or images. The pure D1 simulation publishes detached snapshots
on a separate 30 Hz timer; its allocations are outside the render loop.

Both timers stop when paused, hidden, showing quit confirmation or terminal. A
monotonic clock settles elapsed time before changing speed. Capture-phase
visibility/pagehide handlers checkpoint before live-progress flush. No hidden time
enters the replay. Resize draws one frame without restarting a paused clock.
Reduced motion/degraded mode freezes sprite cycling, hides impact decoration and
suppresses haptics; essential pest/projectile movement remains visible.

Ten keyboard-focusable/tappable slots open a compact radial picker with all four
names and prices. Unaffordable choices are disabled. Existing towers offer two
upgrades and half-spend selling. The HUD shows level, wave /5, coins and breads;
the target TierView photo changes each wave. The bread pile consumes ascending
snapshot indices, keeping the highest-priced bread until last. Controls include
1×/2×, early wave and remembered sound. The shared top bar has a back chevron,
exit action and speaker icon; opening the exit sheet pauses simulation. All visible copy is in `src/copy.ts`.

## Art handoff

Fetch `/brand/td/manifest.json` at runtime. Its schema matches RUN: `version`,
`baseUrl`, `pixelRatio`, and `assets[name]` containing `file`, `frameSize`,
`frameCount`, `columns`, `rows`, `fps`, `loop`, `anchor`, and
`frames:[{rect:[x,y,w,h],anchor:[x,y]}]`. Extra RUN metadata is allowed.
Each file is decoded before use. Missing manifests, entries or files fall back
independently to simple shapes. No TD manifest is fabricated during D2.

Required names:
`map-1`, `map-2`, `map-3` (complete 720×1080 maps including paths);
`tower-pin-0..2`, `tower-sifter-0..2`, `tower-whisk-0..2`, `tower-oven-0..2`;
`pest-ant`, `pest-mouse`, `pest-sparrow`, `pest-beetle` (walk frames);
`proj-pin`, `proj-whisk`, `proj-oven`, `fx-hit`, `slot`.

## Persistence and checks

`bb_td_save_v2` stores run metadata, tier photos, input log and exact simulation tick.
It checkpoints each simulation second and every input/pause/hide/exit/terminal state.
Resume replays the log; expired, malformed, wrong-version, wrong-level, mismatched-score
or noncanonical terminal saves are discarded. Completed saves remain until the server
acknowledges that run, allowing the same finish to retry after reload/network failure.
Quit confirms save/discard; restart confirms discarding the unfinished attempt.

Unit coverage includes D1 engine/balance, clock speed/pause, save replay, optional
manifest fallback, transport bounds, suspicious flags and prize eligibility. Real
Postgres coverage includes migration/default compatibility, same-week gating,
concurrent completion, terminal losses, prefix/time validation, live activity,
price/photo snapshots, shared bans, admin, prize gates and public routes.
`tests/e2e/td.spec.ts` defines Chromium at file top level and covers 320/390×700,
radial controls, pause/hidden time, save/resume/discard, results, finish retry and the
six-card hub. RUN's hub expectations now reflect two columns and three rows.

## PRE-DEPLOY

- Apply `20261031200000_game_kind_td` after the shared game-level migration and
  regenerate Prisma.
- Replace `TD_PRIZE_FROM_WEEK = "2026-12-07"` with the Chicago Monday after the
  actual first production week. Automatic draws and owner overrides honor it.
- Run the authored browser tests and manually verify the layout/interaction on a
  WeChat phone. Browser execution was explicitly excluded from this task.
- D3 can add the manifest and files without changing the route or rendering contract.

Non-browser commands: `npx tsc --noEmit --incremental false`, `npm run lint`,
`npx vitest run --configLoader runner --project unit --maxWorkers 2`,
`TEST_DATABASE_URL=…/bunbunny_td2_test npx vitest run --configLoader runner --project db`,
`npm run fonts`. Only database names ending `_test` are permitted. The separate TD2
DB avoids an older failed migration already present in the default test database.

Verification on 2026-10-31: TypeScript and repository ESLint passed. The complete
unit suite passed 1,137 tests; the subsequently added manifest decode case passed
with all four TD client tests (1,138 unit cases total). The full DB run executed
825 cases; four stale catalog/fixture assertions were corrected, then all 38 cases
in the four affected files plus the new additive TD migration file passed (826 DB
cases covered in total). Fonts regenerated successfully. No e2e/browser execution
and no commit were performed.

## D4 polish (2026-10-31)

- TD, RUN and GRAB share the page shell, speaker, primary/secondary styles and
  registration fields (including placeholders). TD HUD uses small grey labels and
  `font-num` values. Exit confirmation is the pause control.
- The endpoint displays ten separate rounded-square photo tiles on a two-row tray.
  Theft fades one fixed-position tile per bread (with a small lift unless reduced
  motion is enabled); surviving tiles never reflow. Terminal frames remove the last
  tile immediately because the renderer stops there.
- The TD hub icon uses the same cream fill and warm brown contour as RUN.
- M3 level progress has explicit WebKit/Firefox track and fill styling; live-score
  e2e mocks supply the current weekly level contract.
- Rejected client inputs stop at 100, including after resume. Further invalid taps
  do not enter the engine or log; valid actions remain available. Server replay
  retains its independent >120 rejection limit.
- Engine v2 seeds and save keys reject v1 unfinished runs. The existing server
  version gate follows `TD_ENGINE_VERSION`; verified historical scores are unchanged.

D4 verification: TypeScript, repository ESLint, all 1,145 unit tests and all 826
Postgres tests passed against `bunbunny_td4_test`. Playwright discovered the 12
updated TD/live-score e2e cases without launching a browser. No commit was made.

## D8 backend handoff

The first-wave button must use `state.awaitingStart` and send `callWave`;
`nextWaveTick === null` now also describes the initial build phase. Client clock
limits must follow `startedTick + MAX_LEVEL_TICKS` after starting, and must not
cap building at 18,000 absolute ticks. The rejected-input throttle must also allow
the first call when `awaitingStart` is true. These component integrations are
outside D8's backend-only scope; `src/components/**` was not changed.

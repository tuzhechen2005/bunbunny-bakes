# RUN client / server (R5, D146 / D150)

`/game/run` follows GRAB's identity form, local save/resume/discard, quit/restart sheets,
leaderboard/crown, sound preference, result verification/retry and prize line. RUN is always
available: fixed art needs no configured bread tiers. The hub now keeps two columns and three rows alongside the sixth TD card (D155). Admin `?game=run`, shared bans, awards and winner email use the
same machinery as the other games. All visible copy is in `src/copy.ts`.

## Rendering and input

The Canvas 2D renderer uses `public/brand/run/manifest.json` frame rectangles and ground
anchors. Dawn sky, scanline-projected scrolling stone texture, whole pre-rendered shop
sprites (uniform aspect-preserving scaling), back-to-front lane objects and the courier
share the projection. Buildings are never sliced into stretched Canvas columns.
The backing store follows CSS dimensions with devicePixelRatio capped at two. Sprites decode
before a start request or resuming the clock; a small loading label and retryable load error
cover slow/failed loads. Static menu/hub crops do not run a Canvas.

rAF runs only while visible, active and unpaused. Capture-phase visibility/pagehide listeners
advance the last active tick before D136 flush, then pause the monotonic clock and cancel rAF.
The collision is frozen at its exact engine tick; three finite timer draws show crash poses
before the result sheet. Hidden/unmounted boards cancel those timers. Reduced motion keeps
essential movement, uses static cyclic frames and disables haptics; no shake/particles are used.

A native non-passive touchmove listener covers the play area. The first ten-pixel movement
locks one direction for that gesture, prevents scrolling, and records an input. Desktop arrow
keys share the same path. Boundary/busy inputs remain in the log; same-tick duplicates and
inputs after MAX_INPUTS are blocked before engine submission, with a visible cap notice. `data-lane`, `data-state` and
`data-tick` on the wrapper expose the real simulation to tests, with no testing bypass.

## Geometry and timing (engine v2)

`src/lib/run/geometry.json` is shared by replay, Canvas projection and Blender. `z = 0`
is exactly the courier's feet line (86% of canvas height); negative z continues behind it.
A linear 2 m contact zone makes the origin and both sprite depth endpoints agree at the
feet line; the distant perspective joins continuously with the same slope.
Each obstacle has front/back extents and a physical height. Blender fits its mesh to these
values and records projected ground endpoints in the manifest. The renderer maps those
endpoints onto the same projected front/back positions. `runGeometry.test.ts` pins this
contract across viewport sizes and distances, including jump lift and slide body height.

Every tick sweeps the movement interval through the obstacle footprint. Collision remains
active after its centre crosses until its back edge passes. A 160 mm inset at either edge
and up to 120 mm height grace (capped at one quarter of obstacle height) make borderline clearance forgiving. Jump lift follows the same
integer parabola in replay and drawing (3.6 m peak, 42 ticks); flour requires visible height,
not merely the jump action. Slide takes 18% of its 36 ticks to crouch and the same time to
stand up; awnings check the shared body-height function throughout the overlap. Carts
remain impassable; coffee remains invulnerable. Lane occupancy follows the drawn lane,
switching once at the horizontal animation's midpoint, for both hazards and pickups.

R5 art uses Cycles CPU at 256 samples, 2× target resolution, Lanczos3 downsampling and
full-quality alpha. Meshes have smoother curves, beveled edges, sculpted facial detail and
folded bag gussets. All runtime assets, including the manifest, remain below 1,500,000 bytes.
`assets-src/run/preview.png` is the unshipped visual review sheet.

## Persistence and verification

`bb_run_save_v${RUN_ENGINE_VERSION}` stores seed, run id, input log, score, nickname, active
elapsed milliseconds and weekly expiry. Loading replays from scratch, checks the exact score
and terminal tick, removes old versions, and rejects expired/malformed saves. Every accepted
input and each elapsed second checkpoints; hiding/exit/finish captures the exact current tick.
Completed saves remain until server acknowledgment and retry the same run after a reload.

Engine v2 seeds use `v2.`; v1 unfinished runs and local saves are rejected rather than
reinterpreted. Finished stored scores remain unchanged. The save payload schema is still
`v: 1`; the storage key and seed carry the engine version.

Finish sends `{runId, inputs:[{tick,dir}], endTick}`; progress uses `{runId,log,endTick}`.
The server replays from scratch, requires exact terminal time, preserves verified prefixes
and monotonic elapsed time, and checks active time against wall time (+ shared slack), capped
at weekly expiry. Pauses do not consume ticks. The engine hard cap is 54,000 ticks / 15 min.
Median input gaps strictly below 120 ms or duration strictly above ten minutes set suspicious;
both remain ranked for owner review. D136/D143 reporting/throttling/tie behavior is shared.

## PRE-DEPLOY

- Apply `20261031130000_game_kind_run` after the GRAB migration and regenerate Prisma.
- Replace `RUN_PRIZE_FROM_WEEK = "2026-12-07"` with the Chicago Monday following the actual
  first production week. New draws/owner selection obey this date; historical prize weeks remain.
- Run `tests/e2e/run.spec.ts` in a browser: 320/390 px hub/menu, touch/keyboard input, collision,
  result, pause/hidden time, save/resume/discard and completed finish retry. Browser execution
  was explicitly excluded from this implementation task.

Checks: `npx tsc --noEmit --incremental false`, `npm run lint`,
`npx vitest run --configLoader runner` (DB names must end `_test`), `npm run fonts`.

# RUN client / server (R7, D146 / D150 / D153 / D157 / D158)

`/game/run` follows GRAB's identity form, local save/resume/discard, quit/restart sheets,
leaderboard/crown, sound preference, result verification/retry and prize line. RUN is always
available: fixed art needs no configured bread tiers. The hub now keeps two columns and three rows alongside the sixth TD card (D155). Admin `?game=run`, shared bans, awards and winner email use the
same machinery as the other games. All visible copy is in `src/copy.ts`.

## Rendering and input

D158 assigns the WebGL rewrite to Claude: game page only, running only during play,
with Canvas 2D fallback when unavailable. Home and other customer pages remain
without WebGL. The following describes the existing R6 Canvas renderer.

The Canvas 2D renderer uses `public/brand/run/manifest.json` rectangles and ground
anchors. The courier is modeled straight along +Y: the camera sees its back, tail,
backpack and upright ears. Eight run frames plus jump, slide, left/right lean and crash
poses are rendered in Docker Blender. Shop elevations (bakery, café, flower shop) have
warm windows, awnings, lamps and planters, without ground plinths. Inverse pinhole
columns map them onto continuous walls parallel to the street, with both sides sharing
the road's vanishing point. The columns sample the full source interval they cover,
with mip filtering on both axes to avoid distant shimmer.

Backing-store DPR is capped at 2. `prepareRunRenderer` builds sky/lane layers, sprite
mip pyramids and road/facade projection tables on load/resize before the clock starts.
The road and walls scroll from these cached textures with fractional source coordinates;
wrap intervals split across the seam instead of stretching the last scanline/column.
A cached road clip preserves smooth road edges; facade columns are one device pixel.
No per-frame canvas filters/shadows, source-sheet downscaling, closures, arrays, projection
objects or DOMMatrix reads. Canvas draws use the closest prefiltered mip (at most √2
minification). The live engine pre-generates its bounded 15-minute track, pools events
and reuses one borrowed frame view; detached snapshots remain available to server replay.
HUD/DOM diagnostics run on a 100 ms timer and React only publishes changed values;
checkpoint copying runs once per second or on input/hide/finish. Audio, terminal reporting
and HUD updates run on that timer or discrete input/lifecycle handlers; rAF only advances
the pooled engine, records scalar flags and draws. Collision freezes/draws at the exact
tick; terminal reporting follows within 100 ms (or immediately on hide/exit).

Sprites decode before starting/resuming. A loading label and retryable load error cover
failed loads. Static menu/hub crops do not run Canvas. In development only, `/game/run?fps=1`
shows a once-per-second rAF readout; it is absent in production. The target is steady
60fps in a mid-phone WeChat WebView. Offline CPU drawing timings are useful regression
checks, not evidence of device FPS; browser/device measurement is still required.

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

## Geometry and timing (engine v4)

R7 starts at 320 mm/tick (19.2 m/s), ramps over 75 seconds (4,500 ticks) to
500 mm/tick (30 m/s), and retains coffee ×1.5 (maximum 750 mm/tick).
The 30-tick reaction budget and track spacing are unchanged.

`src/lib/run/geometry.json` is shared by replay, Canvas and Blender. One continuous
pinhole uses `scale = 24000 / (24000 + z)` and its exact inverse throughout the street.
`z=0` is the courier's feet (86% height); the horizon is 33%. Camera height is 10000 mm;
world height projects as `mm / cameraHeight * canvasHeight * (feet - horizon) * scale`.
Cart height is 4400 mm versus a 3400 mm bunny (1.294×); at 650 CSS px this is about
152 px versus 117 px. No contact-zone branch or footprint-derived whole-sprite scale.

D150's front/back extents remain authoritative. Obstacle sprites use continuous vertical
bands: the physical top scales with pinhole depth, while the authored back, origin and
front ground rows map individually onto the projected replay endpoints. This preserves
the collision footprint without scaling the whole body by a depth derivative. Puddles
use the same ground mapping (their height marker lies inside the ground footprint).
`runGeometry.test.ts` pins dimensions, feet, camera inverse, growth, jump lift, slide
height and cart ratio; renderer tests check the actual submitted ground bands.

Every tick sweeps the movement interval through the obstacle footprint. Collision remains
active after its centre crosses until its back edge passes. A 160 mm inset at either edge
and up to 120 mm height grace (capped at one quarter of obstacle height) make borderline clearance forgiving. Jump lift follows the same
integer parabola in replay and drawing (3.6 m peak, 42 ticks); flour requires visible height,
not merely the jump action. Slide takes 18% of its 36 ticks to crouch and the same time to
stand up; awnings check the shared body-height function throughout the overlap. Carts
remain impassable; coffee remains invulnerable. Lane occupancy follows the drawn lane,
switching once at the horizontal animation's midpoint, for both hazards and pickups.

R6 art uses Cycles CPU at 256 samples, 2× target resolution, Lanczos3 downsampling and
full-quality alpha. Meshes have smoother curves, beveled edges, sculpted facial detail and
folded bag gussets. All runtime assets, including the manifest, remain below 1,500,000 bytes.
`assets-src/run/preview.png` is the unshipped visual review sheet.

## Persistence and verification

`bb_run_save_v${RUN_ENGINE_VERSION}` stores seed, run id, input log, score, nickname, active
elapsed milliseconds and weekly expiry. Loading replays from scratch, checks the exact score
and terminal tick, removes old versions, and rejects expired/malformed saves. Every accepted
input and each elapsed second checkpoints; hiding/exit/finish captures the exact current tick.
Completed saves remain until server acknowledgment and retry the same run after a reload.

Engine v4 seeds use `v4.`; v1/v2/v3 unfinished runs and local saves are rejected rather than
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

R6 verification (2026-10-31): TypeScript, ESLint and all 1,115 unit tests passed
(`--configLoader runner --project unit --maxWorkers 2`). Public assets: **462,158 bytes**.
Offline CPU Canvas at 390×650 CSS px / DPR 2: 240 draws, median 1.52 ms, p95 2.67 ms.
The reviewed `preview.png` contains actual-renderer street views and the Blender pose sheet.
No browser/device run was performed; the CPU timing does not certify WeChat 60fps.

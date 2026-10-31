# RUN client / server (R3+R4, D146)

`/game/run` follows GRAB's identity form, local save/resume/discard, quit/restart sheets,
leaderboard/crown, sound preference, result verification/retry and prize line. RUN is always
available: fixed art needs no configured bread tiers. The hub keeps two columns with RUN
spanning the last row. Admin `?game=run`, shared bans, awards and winner email use the
same machinery as the other games. All visible copy is in `src/copy.ts`.

## Rendering and input

The Canvas 2D renderer uses `public/brand/run/manifest.json` frame rectangles and ground
anchors. Dawn sky, scanline-projected scrolling stone texture, upright depth-scaled shop
strips (palette crossfade), back-to-front lane objects and the courier share the projection.
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

## Persistence and verification

`bb_run_save_v${RUN_ENGINE_VERSION}` stores seed, run id, input log, score, nickname, active
elapsed milliseconds and weekly expiry. Loading replays from scratch, checks the exact score
and terminal tick, removes old versions, and rejects expired/malformed saves. Every accepted
input and each elapsed second checkpoints; hiding/exit/finish captures the exact current tick.
Completed saves remain until server acknowledgment and retry the same run after a reload.

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

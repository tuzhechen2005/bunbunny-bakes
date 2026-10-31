# GRAB client (G4 / D149)

`/game/grab` follows M3's menu, identity form, leaderboard, quit/restart sheets, score verification,
record crown, sound preference and retry behavior. Three illustrated cards explain launch, perfect
bread and clock bonuses. The home card is unchanged; the hub now has four equal cards in a 2×2 grid.
All UI copy is in `src/copy.ts`; `npm run fonts` includes the new characters.

## Rendering and time

`GrabBoard` renders the shared v4 engine in a 720×1080 (2:3) aspect box. The play area
fills the viewport below TopBar through the bottom safe area (10px inset), fitting by both
height and width and keeping the board bottom-aligned. Spawn rows are 420/610/800/990 with
±16 units of vertical jitter; radii remain 41/57/73. The full field is designed to fit a
390×700 viewport without scrolling. E2E assertions cover that viewport and 320×700.
The bunny remains attached to the actual board pivot. The claw pivots at top centre; its
stretched SVG arm and independent tong head follow the angle/length above held bread.

The animation loop paints arm rotation, arm stretch, tong translation and held-item translation
through DOM refs using transforms. React receives a new snapshot only when HUD seconds, score,
phase, held identity, field identity/stage/refill animation, oven warmth or score pops change.
Field sprites have stable run-wide keys and memoized visual props: aging alone does not render
them. QA `data-tick`, `data-phase` and `data-launches` are updated directly each frame, independent
of React's presentation cadence. `onProgress` still receives the exact latest simulation tick;
launch logs are immutable and copied only on an accepted input.

Tier photos have 22% rounded corners. There are no CSS image filters or animated box shadows:
raw uses a faint paper overlay, perfect uses a static linen outline and opacity-only sparkle,
and burnt uses a narrow crust border. At age 601, after one second burnt, the oven renews field
bread at the same position/size/tier, with a fresh id and raw age zero. Held doneness stays frozen
at contact for scoring. Automatic renewal draws no random bonuses and cannot prolong the run.
Delivery events produce sound, haptics and score pops (48-tick lifetime, hard cap of four).
Refills briefly brighten the oven through opacity. The background reuses M3's `BoardPaper`.

The resource audit found no growing event/listener collection: each engine action replaces its
event batch; refills drain their queue; visibility/pagehide listeners and rAF are removed on
cleanup. Existing shared sound uses one lazy AudioContext and schedules every oscillator to stop;
GRAB adds no audio-node collection. Score-pop expiry also runs after bonus extensions. Target is
steady 60fps on a midrange phone/WeChat; actual device frame rate remains a playtest check, since
this task explicitly excludes running browsers.

`grabClock.ts` accumulates only active milliseconds with an injected monotonic time source. The frame
loop runs only during visible, unpaused play and stops at expiry. Exit confirmation and document
visibility pause the clock; resumption starts from the saved active elapsed time. Capturing hide/pagehide
listeners advance the final active tick before the shared progress reporter flushes. Reduced motion
and degraded mode disable sparkle pulses, refill travel, score movement and haptics; essential claw physics remain.

## Input regression (G3 round 2)

The reviewed implementation already used `onClick` and disabled pointer events on decoration.
A zero score / idle screenshot 0.7 seconds later does not prove input loss: an outward miss at
±70° can complete its entire v1 cycle in 45 ticks (0.75 seconds). The screenshots contain no
launch log, so their exact cause cannot be established without the browser reproduction.
There was also a real dropped-input window: `active.current` stayed false until a deferred
boot, and effect cleanup reset it when sound/motion preferences changed. An otherwise eligible
press during that window returned without launching.

Launch eligibility now checks paused/hidden/over state, independent of rAF boot. Primary
pointerdown launches immediately for touch, mouse and pen; `click` handles keyboard/assistive
activation (`detail === 0`).
A nonzero-detail click also works when no pointer event was received; a 500 ms window after
pointer down/up/cancel suppresses compatibility clicks. Busy presses remain absent from the canonical log. `data-phase`, `data-tick` and `data-launches`
expose the actual physics state for QA. E2E covers a real `.tap()`, immediate `extending`, then
an aimed `mouse.click()` in a touch context with exactly one accepted launch and a scored delivery.
A separate frozen-clock test taps before the deferred boot, reproducing the dropped-input window.
No retry-until-scoring loop can hide dropped input. Browser execution remains assigned to Claude.

## Saves and requests

`bb_grab_save_v${GRAB_ENGINE_VERSION}` stores seed, run id, tier photos, launches, score, nickname,
active elapsed milliseconds and expiry. Saves are replay-validated and old-version keys removed.
Physics version 4 invalidates v1/v2/v3 saves/runs after the field/contact/renewal changes.
Accepted launches save immediately, elapsed time checkpoints once per second, hide/exit saves the latest
snapshot, and the completed log stays until finish acknowledgment or explicit discard. Resuming a
completed log retries the same run. Busy taps are ignored locally and are not added to the log.

The wire format is `{ runId, launches, endTick }` for finish and `{ runId, log, endTick }` for progress.
No independently editable millisecond input log exists. `elapsedTick` uses `round(elapsedMs*60/1000)`.
The server replays with that observation tick, so deliveries after the last launch are included.
D136 reporting and D143 throttling/tie-break behavior reuse the common client/server machinery.

## Original artwork and release

`public/brand/grab/` contains original source SVGs drawn for this game: bunny, tongs, stretched arm,
oven, flour sack, butter, clock, bread fallback/rules illustration and small hub icon. Warm cream,
toasted ochre and muted copper palettes live inside SVG files. No third-party game assets or layout
were used. Component colors use existing global tokens.

**PRE-DEPLOY:** apply `20261031120000_game_kind_grab`, regenerate Prisma, and change
`GRAB_PRIZE_FROM_WEEK = "2026-12-07"` to the Chicago Monday following the actual first production week.
At least three configured non-big tiers are required for opening a run and for new prize selection.
Existing prize weeks remain stable, including historical weeks used by the winner cron.

Verification: `npx tsc --noEmit`, `npm run lint`, `npx vitest run --configLoader runner`, `npm run fonts`.
DB verification uses only `_test` databases. `tests/e2e/grab.spec.ts` covers 320/390 px, the four-card hub,
menu, real launch/delivery physics, game over, live progress, resume, hidden time, reduced motion and
completed-save retry with mocked HTTP. Browser execution is intentionally left to Claude.

G3 round 2 verification: `tsc --noEmit`, ESLint and fonts passed; full Vitest passed
139 files / 1,854 tests using `bunbunny_grab_g3_round2_test` (the default test database had
an existing failed migration). The updated old-version DB case also passed separately.
Browser tests were authored but not executed, per the review brief.

G4 verification (10/31): `npx tsc --noEmit` and `npx eslint .` passed after generating the
worktree's Prisma client. `npx vitest run --configLoader runner --project unit --maxWorkers=2`
passed 83 files / 1,097 tests; the first unrestricted run had four timeout-only failures under
concurrent load. `npx vitest run --configLoader runner --project db`, with `TEST_DATABASE_URL`
pointing to local `bunbunny_grab_g4_test`, passed 69 files / 836 tests against real Postgres. The default test database still has its pre-existing failed migration, so verification
used the isolated `_test` database. Unit coverage includes forgiving sweep/tie selection,
repeated bread renewal, unchanged clock supply, held-stage scoring, v3 save rejection, and
bounded presentation changes through a clock-extended run. DB coverage rejects v1/v2/v3 seeds
for both finish and progress. Updated browser tests were authored only, never executed.

# GRAB client (G2/G3 / D145)

`/game/grab` follows M3's menu, identity form, leaderboard, quit/restart sheets, score verification,
record crown, sound preference and retry behavior. Three illustrated cards explain launch, perfect
bread and clock bonuses. The home card is unchanged; the hub now has four equal cards in a 2×2 grid.
All UI copy is in `src/copy.ts`; `npm run fonts` includes the new characters.

## Rendering and time

`GrabBoard` renders the G1 snapshot in a 720×1440 aspect box using DOM positions and CSS transforms.
The play area fills the viewport below TopBar through the bottom safe area (10px inset).
It fits the board by height with horizontal gutters; extra-tall screens constrain by width
and keep the board bottom-aligned. The bunny remains attached to the actual board pivot.
The taller ratio avoids stretching circles or leaving the lower half of a phone empty.
The claw pivots at top center. A stretched SVG arm and independent tong head follow its angle/length;
the bunny sits above that pivot. Tier photos have 22% rounded corners and size-dependent dimensions.
Raw/perfect/burnt filters express doneness without text: raw is gently pale and warm,
perfect keeps full colour with a linen glow and small gold sparkle, burnt is toasted brown.
The head is 1.5× its previous logical width; the stretched arm stays joined to it, above held bread. Delivery events produce score pops, sound and
light haptics; refill events briefly warm the oven door. The background reuses M3's `BoardPaper`.

`grabClock.ts` accumulates only active milliseconds with an injected monotonic time source. The frame
loop runs only during visible, unpaused play and stops at expiry. Exit confirmation and document
visibility pause the clock; resumption starts from the saved active elapsed time. Capturing hide/pagehide
listeners advance the final active tick before the shared progress reporter flushes. Reduced motion
and degraded mode disable glow pulses, score movement and haptics; essential claw physics remain.

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
activation only (`detail === 0`), preventing compatibility clicks from submitting a second launch.
Busy presses remain absent from the canonical log. `data-phase`, `data-tick` and `data-launches`
expose the actual physics state for QA. E2E covers a real `.tap()`, immediate `extending`, then
an aimed `mouse.click()` in a touch context with exactly one accepted launch and a scored delivery.
A separate frozen-clock test taps before the deferred boot, reproducing the dropped-input window.
No retry-until-scoring loop can hide dropped input. Browser execution remains assigned to Claude.

## Saves and requests

`bb_grab_save_v${GRAB_ENGINE_VERSION}` stores seed, run id, tier photos, launches, score, nickname,
active elapsed milliseconds and expiry. Saves are replay-validated and old-version keys removed.
Physics version 2 invalidates v1 saves/runs after the field/radius/speed changes.
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

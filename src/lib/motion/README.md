# Motion primitives (`src/lib/motion/`)

Pure TS physics for the customer redesign (docs/FRONTEND.md section 5). No React, no DOM, unit
tested in `tests/unit/motion/`. React glue is only in `react.ts`. Import from `@/lib/motion`
(index re-exports everything except `react.ts`, which is a client module).

| File | API |
|---|---|
| `spring.ts` | `class Spring(initial, config = ROPE_SPRING)`: `.target`, `.x`, `.v`, `.step(dtSeconds)`, `.set(x, v?)`, `.isAtRest(epsX?, epsV?)`, `.settle()`. Fixed `SUBSTEP = 1/240` s with carried remainder, so 60 and 120 Hz agree. `ROPE_SPRING = {1.7 Hz, 0.9}`. |
| `pendulum.ts` | `class Pendulum(config = PEG_PENDULUM)`: `.angle` (rad, 0 = down, +x tilt), `.step(dt, pivotAccel)`, `.isAtRest()`, `.settle()`. `PEG_PENDULUM = {length 0.42 m, damping 0.85, maxDrive 5 m/s^2}`. `pivotAccel(prevV, v, dt, pxPerMetre)` converts a pivot velocity change (px/s) to m/s^2. Pivot accelerating toward +x tilts the photo toward -x. A hard capped flick peaks at about 6 deg for a 0.1 s push at the cap and 11 deg for 0.2 s (spec: 10-15 deg for a hard flick); a sustained cap-level push tops out below 30 and rests in about a second. |
| `gesture.ts` | `class GestureTracker`: `start(x,y,t)`, `move(x,y,t)` returns dx once locked to the x axis (8 px) else `null` (leave the page to scroll), `end(t)` returns `{velocity px/ms, fling -1/0/1}` (last 100 ms; no fling after an 80 ms pause). `rubberBand(pos, min, max, limit = 0.45)` and `snapTarget(position, startIndex, flingDir, count)` work in item units; a fling moves at most one item. Use `touch-action: pan-y` on the rack. `new GestureTracker({ lockPx, horizontalBias })` changes the lock distance (default 8) and the axis bias (default 1); `decideAxis(dx, dy, bias)` is the same rule as a function. The home rack uses `lockPx 4`, `horizontalBias 0.75` (see below). |
| `loop.ts` | `createLoop(step(dt, now) => boolean)` returns `{start, stop, running}`. Return `true` while anything moves; returning `false` stops rAF entirely. Call `start()` again on the next input. `dt` is clamped to 0.1 s. Frames feed `motionHealth`. |
| `fps.ts` | `FpsMonitor` and the shared `motionHealth`: sticky `degraded` after fps stays under 45 for 1.5 s. Idle gaps (> 250 ms) are ignored. |
| `react.ts` | `useMotionPrefs()` returns `{ reduced, degraded }`; `haptic(ms = 15)` (never throws). |

## Rules for consumers

- `reduced`: no swing, flight, spin or screen shake, use fades only; numbers change in place.
- `degraded`: keep translation, drop the pendulum and the side tilt.
- Drive DOM from refs inside the loop (`style.transform`), not React state per frame.
- Animation library: `m.*` from `motion/react`, never `motion.*`. `m` needs a LazyMotion
  ancestor: wrap your page/component in `components/reactbits/MotionProvider` (features load as
  a separate lazy chunk, ~19 KB gzip). It is deliberately NOT in the root layout (it costs about
  11 KB gzip of first-load JS on every route, admin included).

## Fly-to-bag (`src/lib/flyToBag.ts`)

```ts
flyToBag({ from: el.getBoundingClientRect(), imageUrl, productId }); // fire and forget
const { ref, onArrive } = useBagTarget(); // in the bag; onArrive(cb) returns an unsubscribe fn
```

Mount `<FlyLayer/>` (`components/customer/bag/FlyLayer.tsx`) once on a page that has a bag.
Timing contract: about 0.6 s arc (`FLY_DURATION_MS`), fixed `pointer-events: none` overlay so
clicks are never blocked, flights may overlap, the cart is updated by the caller at click time
(not on arrival), `onArrive` is decoration only (bag swing, haptic). Under reduced motion the
flight is skipped and `onArrive` fires immediately.

## Touch dragging (D77)

On phones (and inside WeChat / app web views) pointer events lose horizontal drags to the page.
Use touch events for touch: decide the axis on the first move (horizontal when |dx| >= 0.75 |dy|),
then `preventDefault()` every `touchmove` of a horizontal gesture (listener with `passive: false`);
vertical gestures are left to the page. Use pointer events for mouse and pen only.

The home rope (`src/components/customer/rack/drag.ts`, `bindDrag`) is the reference implementation: native
`touchstart` (passive) / `touchmove` (`passive: false`) / `touchend` / `touchcancel` on the whole hero, axis
decided at 4 px with bias 0.75, `preventDefault` on every `touchmove` once the gesture is claimed, mouse and pen
through pointer events only (`pointerType !== "touch"`). `tests/e2e/rack.spec.ts` drives it with real touch
events through CDP (`Input.dispatchTouchEvent`, Chromium only).

## Pile (`pile.ts`): the bread in the paper bag window

`new PileWorld({ random? })` is a pure, deterministic 2D world for the round thumbnails inside the
bag (FRONTEND.md 4.3, D78). World units: `PILE_WIDTH = 116` wide, `PILE_HEIGHT` (135.6, the window aspect)
tall, y grows downward.

| API | |
|---|---|
| `spawn(tag, x?, y?)` | Drop a body in from above the box (`x` clamped to the walls). Returns `null` at the cap (`PILE_CAP = 24`). A little random height jitter keeps simultaneous bodies from landing in one exact row. |
| `remove(tag, count)` | Removes the topmost bodies of a tag and returns them (the view pops them out of the bag top). |
| `advance(dt)` | Real-time step (any `dt`): fixed `PILE_STEP = 1/120` s Verlet steps with the remainder carried, gravity 1500, 4 constraint iterations, wall and floor friction. Returns `true` while awake: feed it to `createLoop` and return it from the step. |
| `settle()` | Run to rest at once: reduced motion and the initial state from the cart. |
| `ax`, `ay` | External acceleration in units/s^2 (shaking the bag, a `jolt`). Non-zero keeps the world awake. |
| `wake()` | Wake a sleeping world (it sleeps after 40 quiet steps and `advance` then costs nothing). |

Radius is 20 up to 5 bodies, then `20 * sqrt(5 / n)` (min 9.5); existing bodies ease toward the new
radius. `radiusFor(n)` exposes the rule. The view (`PaperBag`) maps world units to px with
`bagWidth * 0.73 / PILE_WIDTH` and writes `transform` on one `<i>` per body from the loop.

## Bag components (`src/components/customer/bag/`)

- `PaperBag` `{ width, items, folded?, imprint?, shakeable? }` + ref `{ jolt(ay, ms?), squash(kind?), windowRect(), drop(productId, count, xFrac?) }`. The pile follows `items` (initial state settled, growth drops in, shrinking pops out). `drop` is for the home bag only (a flight landed at `xFrac`).
- `BagBar` (props unchanged) renders the mini bag + pill and, in a portal while open, `BagSheet`.
- `FlyLayer` draws the flights; `bagFlights.ts` keeps the breads in the air (`pending`) so the bags show the cart minus the flying bread and a landing drops them in exactly once.
- A bag window is found by `[data-bag-target="sheet" | "bar"] [data-pb-window]` (sheet first), so flights land in whichever bag is visible.

## Control kit (`src/components/ui/`) and overlay history

- `Stepper` `{ qty, size: sm 42 | md 44 | lg 58, tone: wash | paper | fink, decreaseLabel, increaseLabel, qtyLabel, ... }`: the - n + pill (bag sheet, checkout lines; the home page can switch to it).
- `Sheet` (ref `{ close(), releaseHistory(), panel, backdrop }`): the one bottom sheet. Backdrop ink 40%, spring in (1.8 Hz / 0.7), 300 ms ease-in out, scroll lock, focus trap, Esc, pull down (more than 110 px or faster than 0.5 px/ms) via `bindDrag`, optional `history` (Back closes it first) and `dismissible={false}` for the save-link dialog. Mark scrolling lists `data-sheet-scroll` and things that must not pull the sheet `data-no-sheet-drag`.
- `TopBar` (56 px, 44 px chevron link, title), `focusRing` (2 px `currentColor`, offset 3 px; red only for errors), `ui.css` (`.ui-skel` loading placeholder).
- `src/lib/overlayHistory.ts`: `pushOverlay(onPop) -> close()`. Back pops the overlay (`onPop` plays the closing animation); closing any other way calls `close()`, which removes the history entry again.

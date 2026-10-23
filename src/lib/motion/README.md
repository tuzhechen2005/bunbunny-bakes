# Motion primitives (`src/lib/motion/`)

Pure TS physics for the customer redesign (docs/FRONTEND.md section 5). No React, no DOM, unit
tested in `tests/unit/motion/`. React glue is only in `react.ts`. Import from `@/lib/motion`
(index re-exports everything except `react.ts`, which is a client module).

| File | API |
|---|---|
| `spring.ts` | `class Spring(initial, config = ROPE_SPRING)`: `.target`, `.x`, `.v`, `.step(dtSeconds)`, `.set(x, v?)`, `.isAtRest()`, `.settle()`. Fixed `SUBSTEP = 1/240` s with carried remainder, so 60 and 120 Hz agree. `ROPE_SPRING = {1.7 Hz, 0.9}`. |
| `pendulum.ts` | `class Pendulum(config = PEG_PENDULUM)`: `.angle` (rad, 0 = down, +x tilt), `.step(dt, pivotAccel)`, `.isAtRest()`, `.settle()`. `PEG_PENDULUM = {length 0.42 m, damping 0.85, maxDrive 5 m/s^2}`. `pivotAccel(prevV, v, dt, pxPerMetre)` converts a pivot velocity change (px/s) to m/s^2. Pivot accelerating toward +x tilts the photo toward -x. A hard capped flick peaks at a few degrees (a sustained cap-level push tops out below 30) and rests in about a second. |
| `gesture.ts` | `class GestureTracker`: `start(x,y,t)`, `move(x,y,t)` returns dx once locked to the x axis (8 px) else `null` (leave the page to scroll), `end(t)` returns `{velocity px/ms, fling -1/0/1}` (last 100 ms; no fling after an 80 ms pause). `rubberBand(pos, min, max, limit = 0.45)` and `snapTarget(position, startIndex, flingDir, count)` work in item units; a fling moves at most one item. Use `touch-action: pan-y` on the rack. |
| `loop.ts` | `createLoop(step(dt, now) => boolean)` returns `{start, stop, running}`. Return `true` while anything moves; returning `false` stops rAF entirely. Call `start()` again on the next input. `dt` is clamped to 0.1 s. Frames feed `motionHealth`. |
| `fps.ts` | `FpsMonitor` and the shared `motionHealth`: sticky `degraded` after fps stays under 45 for 1.5 s. Idle gaps (> 250 ms) are ignored. |
| `react.ts` | `useMotionPrefs()` returns `{ reduced, degraded }`; `haptic(ms = 15)` (never throws). |

## Rules for consumers

- `reduced`: no swing, flight or 3D, use fades only; BlurText/ShinyText/CountUp already render the final state.
- `degraded`: keep translation, drop the pendulum and the side tilt.
- Drive DOM from refs inside the loop (`style.transform`), not React state per frame.
- Animation library: `m.*` from `motion/react`, never `motion.*`. `m` needs a LazyMotion
  ancestor: wrap your page/component in `components/reactbits/MotionProvider` (features load as
  a separate lazy chunk, ~19 KB gzip). It is deliberately NOT in the root layout (it costs about
  11 KB gzip of first-load JS on every route, admin included). `BlurText` wraps itself; `CountUp`
  (uses `animate`) and `ShinyText` (CSS only) need no provider.

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

## React Bits (`src/components/reactbits/`)

`BlurText`, `CountUp`, `ShinyText` only (D68), adapted from React Bits under MIT + Commons Clause
(`LICENSE.md` there). All take the final state immediately when `reduced`.

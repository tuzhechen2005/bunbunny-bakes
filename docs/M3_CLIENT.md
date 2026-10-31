# M3 client (S3 / D135, D142)

`/game/m3` uses the S1 pure engine and the S2 API contract. `m3Api.ts` shares the game's
HTTP helper and response types; there is no client dependency on the TU engine or Canvas.
Six bread tiers are required by both the start response guard and save parser. Saves are
versioned by `M3_ENGINE_VERSION`, expire at the server's `expiresAt`, and are replay-validated.
Accepted moves are saved before animation, including the final move, so reloading mid-cascade
resumes/retries the same run. Completed logs remain until finish acknowledgment or explicit discard;
resuming a completed save retries the same run without starting a new one.
Events play in engine order; only active transitions run a frame
monitor. Reduced motion and automatic degraded mode use fades, without hints or haptics.

## Integration / release

- S2 supplies the three `/api/game/m3/*` routes, the `M3` GameKind migration, and admin support.
  S3 includes the matching Prisma enum member for type generation; it adds no migration.
  Merge the S2 migration before deploying this route/catalog/prize pool.
- `src/lib/gamePrizePool.ts` contains `M3_PRIZE_FROM_WEEK = "2026-11-30"`, the Chicago Monday
  after the planned first production week of November 23 (deployment after November 22). **If first production
  appearance slips, move this date to the Monday after its actual first appearance.**
  The current/start week stays ineligible. Every new draw also requires six configured bread
  tiers (the same `loadTierConfigs` source as other games, excluding the synthetic big tier).
  Owner overrides obey the same eligibility gate. Already persisted weekly draws stay stable
  (including historical weeks used by the winner cron), preserving D133.
- M3 special-piece illustrations are in `public/brand/m3/`; the board paper remains inline
  in `M3Art.tsx`, and the hub loaf icon is in `GameIcon.tsx`.
- `tests/e2e/m3.spec.ts` mocks all API requests and exercises the real engine at 320/390 px.
  Swipe remains the primary input: non-overlapping cell targets are at least 39 px at 320 px
  and 44 px at 390 px, with no additional small-screen interaction.
  Browser execution is intentionally left to Claude; add the real-server spec after S2 merges.

Verification: `npm run test:unit -- --configLoader runner`, `npx tsc --noEmit`, `npm run lint`,
`npm run fonts`. No production database is needed for these checks.

## Art (S6)

Hand-drawn `roll.svg` replaces the black frame with a diagonal wooden rolling pin: a broad
barrel, restrained grain/highlight, narrow handles and rounded knobs, with a soft shadow.
`big.svg` is a larger golden boule with cream scoring, a toasted base, sheen and a small
sparkle. Illustration colours live in the SVG assets; pieces retain their 22% rounded corners.
The mark wrapper breathes from 1 to 1.08 over 1.6 seconds, while its image hops 2.5px with a
soft landing every 3.2 seconds. CSS cell phases stagger both loops. Idle motion resets during
board playback, travel/invalid/pop/refill/flash effects, hints and shuffles; quiet/degraded and
reduced-motion modes keep marks still. No idle JavaScript loop, target or aria changes.

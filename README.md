# 🐰的大面包 · Bunbunny Bakes

Online pre-ordering and order management for a one-person bakery.

Customers pick bread, a pickup date, and pickup or delivery, and leave their WeChat ID. The owner confirms orders in an admin panel. The system makes sure no day takes more orders than can actually be baked: a daily dough limit (with cheese wedges counted per whole round), a separate daily limit for crème brûlée, delivery slots, and order cutoffs.

No online payment: customers pay after they receive their order.

> **Status:** requirements finalised, no code yet. Start with [`docs/PRD.md`](docs/PRD.md) and [`docs/TASKS.md`](docs/TASKS.md).

## Stack

Next.js (App Router, TypeScript) · Postgres (Neon) + Prisma · Vercel · Resend · cron-job.org

## Run locally

Prerequisites: Node.js 20+ and Docker.

```sh
cp .env.example .env     # then fill in DATABASE_URL / DIRECT_URL, e.g.
                         # postgresql://bunbunny:bunbunny@localhost:5432/bunbunny
docker compose up -d     # Postgres 16 on localhost:5432
npm install
npm run dev              # http://localhost:3000
npm test                 # unit + db tests (Vitest)
```

Other scripts: `npm run test:unit`, `npm run test:db`, `npm run test:e2e` (Playwright; run `npx playwright install` once first), `npm run lint`, `npm run build`.

## Production database (Neon)

Two URLs to the same Neon database, both from the Neon console (Connection string):

| Variable | Which Neon URL | Used by |
|---|---|---|
| `DATABASE_URL` | **pooled** (host contains `-pooler`, PgBouncer transaction mode) | the app at runtime (`src/server/db.ts`) |
| `DIRECT_URL` | **direct, non-pooled** (same host without `-pooler`) | the Prisma CLI: `prisma migrate deploy`, `migrate status`, `db seed` (`prisma.config.ts`) |

```sh
DATABASE_URL=postgresql://<user>:<password>@<endpoint>-pooler.<region>.aws.neon.tech/<db>?sslmode=verify-full&channel_binding=require
DIRECT_URL=postgresql://<user>:<password>@<endpoint>.<region>.aws.neon.tech/<db>?sslmode=verify-full&channel_binding=require
```

- No extra URL parameters are needed for the pooled URL (no `pgbouncer=true`, no `connection_limit`): the app uses
  the node-postgres driver adapter, which sends unnamed statements and keeps all locks inside transactions
  (`FOR UPDATE`, `pg_advisory_xact_lock`), which PgBouncer transaction mode supports. Verified against Neon
  with the full db test suite via the pooled URL.
- `sslmode=verify-full` is what node-postgres does today for `require` anyway; writing it out silences its
  deprecation warning and keeps certificate checking when pg 9 changes what `require` means.
  (`channel_binding=require` from Neon's copy button is a libpq option; node-postgres ignores it, the Prisma CLI may use it. Harmless either way.)
- **`DIRECT_URL` must be the non-pooled URL.** `prisma migrate deploy` takes a *session* advisory lock
  (`pg_advisory_lock(72707369)`). Through the pooler that lock lands on a shared server connection and is never
  released, and every later `migrate deploy` (even via the direct URL) then fails with `P1002 … Timed out trying to
  acquire a postgres advisory lock` until that pooler connection is closed. If that ever happens: on the direct
  URL, `SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND objid = 72707369
  AND database = (SELECT oid FROM pg_database WHERE datname = current_database()) AND granted`, then
  `SELECT pg_terminate_backend(<pid>)`. Only do this when no migration is running: the same lock is
  held legitimately while a `prisma migrate deploy` is in progress.

Running the db tests against a Neon branch (database name must end in `_test`):

```sh
TEST_DATABASE_URL=<pooled url> TEST_DIRECT_DATABASE_URL=<direct url> \
DB_TEST_REMOTE=1 DB_TEST_TIMEOUT_SCALE=4 npm run test:db
```

`DB_TEST_TIMEOUT_SCALE` multiplies the db tests' timeouts (every query is an internet round trip);
`DB_TEST_REMOTE=1` skips the one test whose premise needs a local server (a 300 ms pool connect timeout).

## Product photos (D91)

Photos are uploaded once at full size and stored as blobs (`/api/images/<product>/<hash>.jpg`, immutable). The customer
pages never load that file directly: `ProductPhoto` uses `next/image`, so the browser asks `/_next/image?url=...&w=...&q=75`
for a width that fits the place it is shown (rope, grid, detail: `sizes` in `src/lib/photo.ts`) and gets avif or webp by its
`Accept` header. `photoUrl(url, width)` builds the same URL for CSS backgrounds (paper-bag discs and the fly layer: 128 px, bag rows: 192 px).
`next.config.ts` only lets the optimizer touch `/api/images/**` and only the widths in `PHOTO_WIDTHS`.

- Local / `next start`: the built-in optimizer (sharp) resizes and caches under `.next/cache/images`. With `IMAGE_STORE=memory`
  this works the same as in production.
- Netlify: the Next runtime maps `/_next/image` to the Netlify Image CDN (no extra config; the `images` block in
  `next.config.ts` is read by the runtime). Resized files are cached at the edge and keyed by URL, which contains the
  immutable photo key, so a replaced photo is a new URL.
- **Rollback:** if the image CDN misbehaves on Netlify, set `PHOTO_OPTIMIZE=off` in the site's build environment and redeploy.
  `next.config.ts` then sets `images.unoptimized` and `photoUrl()` returns the stored file, so every photo (`<img>` and CSS
  backgrounds) is served as uploaded, exactly as before D91. Remove the variable to turn optimization back on.
- The home page (`src/app/page.tsx`) reads the menu on the server with the same function as `/api/menu`
  (`src/server/menuCache.ts`, `use cache`). The copy is refreshed on the first request after `MENU_CACHE_SECONDS` (default 60);
  while it refreshes, that request may still get the old copy, for up to a minute more. Every successful admin write calls
  `revalidateMenu()`, which drops it at once. The page still refetches `/api/menu` on mount, so the client answer wins.
- `HOME_INITIAL_MENU=off` disables the server copy. Playwright sets it for the normal suite (those specs mock `/api/menu`).
  To test the production path run `tests/e2e/server-menu.spec.ts` alone with `E2E_SERVER_MENU=1` (the config then leaves the flag
  unset), e.g. `E2E_SERVER_MENU=1 TEST_DATABASE_URL=<a *_test db> npx playwright test -c playwright.local.config.ts tests/e2e/server-menu.spec.ts`
  against a production build.

## Docs

| File | What it covers |
|---|---|
| `docs/PRD.md` | Product, scope, acceptance criteria |
| `docs/DECISIONS.md` | Every decision and where it came from |
| `docs/CAPACITY_RULES.md` | Capacity, pricing and cutoff rules with worked examples |
| `docs/DATA_MODEL.md` | Tables, order states, the order transaction |
| `docs/API_SPEC.md` | Endpoints and errors |
| `docs/PAGES.md` | Pages and Chinese UI copy |
| `docs/NOTIFICATIONS.md` | Emails and scheduled jobs |
| `docs/SECURITY.md` | Auth, private order links, abuse protection |
| `docs/TASKS.md` | Milestones |
| `docs/HANDOFF.md` | Where things stand |

### Dawn delivery runner (R13)

`/game/run` uses engine/replay **v8**: starts at 480 mm/tick (28.8 m/s), reaches
680 mm/tick (40.8 m/s) in 35 seconds, and coffee caps at 1020. Rows are 60m apart;
obstacles begin around second 3, trucks around 15–16 seconds, with mandatory
jump/slide-and-change gates and roof-only van trains. After about 60 seconds,
every row requires an action or a roof route. Coffee is four times rarer per eligible row.
The fixed casual bot median is **17.88s** (target 12–20s); snapshot search survives
more than five minutes across 100 seeds. Old unfinished v1–v7 runs/saves are rejected;
finished scores remain unchanged. See [engine rules and verification](src/lib/run/README.md)
and [RUN client](docs/RUN_CLIENT.md). No components or browser execution in R13.

## 三连烤 weekly levels (S9)

M3 uses engine v3 and D151 weekly levels. Apply `20261031180000_game_levels` with the usual
Prisma migration deployment before releasing the app. `GameRun.level` / `passedAt` are nullable;
other games and historical scores are preserved. Old v2 M3 saves/runs cannot resume.
The shared level-board policy lives in `src/server/gameLevels.ts`; prize selection still uses
`M3_PRIZE_FROM_WEEK`. See [engine rules and per-level bot pass rates](src/lib/m3/README.md).
Over 100 fixed weeks: greedy L1 **97.0%**, L12 **50.0%**, L25 **3.0%**;
every generated board has a replayable winning witness.

```sh
npx tsx scripts/m3-level-tune.mts 100
npx tsc --noEmit
npx eslint .
npx vitest run --configLoader runner --project unit --maxWorkers 2
TEST_DATABASE_URL=postgresql://bunbunny:bunbunny@localhost:5432/bunbunny_m3_levels_test \
  npx vitest run --configLoader runner --project db
```

Only `_test` databases are allowed for DB checks. M3 Playwright specs cover next level, retry,
autosave/resume, target HUD and v2 rejection; they were updated without launching browsers.

## 保卫大面包 progression and maps (D9)

TD engine/replay **v9** uses per-level data maps in a **1440 × 810** field.
L1–L10 have authored lesson layouts; L11+ derives varied routes and increasing
path features from `(weekKey, level)`. Slots grow from 3 to 11. Seven towers unlock
at L1/3/5/8/11/14/18; bomb, bell and slide unlock at L2/6/10 with server-authorized,
once-per-type use. Fork switches and items are deterministic replay inputs.
Old v1–v8 unfinished runs and saves are rejected. The renderer should consume
`mapData` rather than baked backgrounds or the legacy map index.

See [engine contracts, E1 integration and L1–L10 ASCII maps](src/lib/td/README.md).
This task changes no `src/components/**` or `src/app/game/**`, launches no browsers,
and makes no commit. DB checks use only an isolated `*_test` database.

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

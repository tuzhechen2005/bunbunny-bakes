# 🐰的大面包 · Bunbunny Bakes

Online pre-ordering and order management for a one-person bakery.

Customers pick bread, a pickup date, and pickup or delivery, and leave their WeChat ID. The owner confirms orders in an admin panel. The system makes sure no day takes more orders than can actually be baked: a daily dough limit (with cheese wedges counted per whole round), a separate daily limit for crème brûlée, delivery slots, and order cutoffs.

No online payment: customers pay after they receive their order.

> **Status:** requirements finalised, no code yet. Start with [`docs/PRD.md`](docs/PRD.md) and [`docs/TASKS.md`](docs/TASKS.md).

## Stack

Next.js (App Router, TypeScript) · Postgres (Neon) + Prisma · Vercel · Resend · cron-job.org

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

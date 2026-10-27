// Local manual smoke test for 小小🐰 against the real DeepSeek API. Never run in CI.
//
//   DEEPSEEK_API_KEY=… DATABASE_URL=postgresql://…/bunbunny_<x>_test \
//     npx tsx scripts/assistant-smoke.mts [--seed] ["问题 1" "问题 2" …]
//
// - Uses DEEPSEEK_API_KEY from the environment; never prints it. Without it, exits.
// - Only talks to a database whose name ends in "_test". --seed adds the default products
//   (if none), turns ordering on, makes 焦糖布蕾 Wednesday-only and opens the next 14 days.
// - Caps real upstream HTTP calls at SMOKE_MAX_CALLS (default 15) for the whole run.

import { randomBytes } from "node:crypto";
import { localDateOf, addDays } from "../src/domain/dates";
import { askAssistant, assistantEnv } from "../src/server/assistant";
import { createPrismaClient } from "../src/server/db";
import { toDbDate } from "../src/server/dbDates";
import { seed } from "../prisma/seed";

const DEFAULT_QUESTIONS = ["周四能取什么", "泡芙怎么订", "可以配送吗"];

async function main(): Promise<void> {
  const env = assistantEnv();
  if (!env.apiKey) {
    console.log("DEEPSEEK_API_KEY is not set; nothing to do.");
    return;
  }
  const url = process.env.DATABASE_URL ?? "";
  const dbName = url ? decodeURIComponent(new URL(url).pathname.slice(1)) : "";
  if (!/_test$/.test(dbName)) throw new Error("DATABASE_URL must name a *_test database");

  const args = process.argv.slice(2);
  const doSeed = args.includes("--seed");
  const questions = args.filter((a) => a !== "--seed");
  const db = createPrismaClient(url);

  const budget = Number(process.env.SMOKE_MAX_CALLS || 15);
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (++calls > budget) throw new Error("smoke: upstream call budget exhausted");
    const t = Date.now();
    try {
      return await realFetch(input, init);
    } finally {
      console.log(`  upstream call ${calls}: ${Date.now() - t} ms`);
    }
  }) as typeof fetch;

  try {
    const now = new Date();
    if (doSeed) {
      // Throwaway admin for an empty test database only (the password is random and unused).
      await seed(db as never, { ADMIN_USERNAME: "smoke", ADMIN_INITIAL_PASSWORD: randomBytes(18).toString("base64url") });
      await db.setting.update({ where: { id: 1 }, data: { orderingEnabled: true } });
      await db.product.updateMany({ where: { name: "焦糖布蕾" }, data: { pickupWeekdays: [3] } });
      const today = localDateOf(now);
      for (let i = 1; i <= 14; i++) {
        const date = toDbDate(addDays(today, i));
        await db.openDate.upsert({ where: { date }, create: { date }, update: {} });
      }
    }
    const products = await db.product.findMany({ select: { id: true, name: true } });
    const nameOf = new Map(products.map((p) => [p.id, p.name]));

    for (const q of questions.length ? questions : DEFAULT_QUESTIONS) {
      const before = calls;
      const started = new Date();
      const outcome = await askAssistant(
        db,
        { messages: [{ role: "user", content: q }], cart: [] },
        "smoke-local",
        started,
        env,
      );
      console.log(`\nQ: ${q}`);
      console.log(`status ${outcome.status} · upstream calls ${calls - before} · ${Date.now() - started.getTime()} ms`);
      if (outcome.status === 200) {
        console.log(`A: ${outcome.body.reply}`);
        const s = outcome.body.suggestion;
        if (s) {
          const items = s.items.map((i) => `${nameOf.get(i.productId) ?? "?"} × ${i.qty}`).join("，");
          console.log(`suggestion: ${items} · date ${s.date ?? "-"} · note ${s.note}`);
        }
        console.log(`remaining ${outcome.body.remaining}`);
      } else {
        console.log(JSON.stringify(outcome.body));
      }
    }
    console.log(`\nupstream calls in total: ${calls}`);
  } finally {
    globalThis.fetch = realFetch;
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "smoke failed");
  process.exit(1);
});

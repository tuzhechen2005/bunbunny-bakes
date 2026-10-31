import { afterAll, beforeEach, expect, it } from "vitest";
import { db, resetDb } from "./helpers";
beforeEach(() => resetDb());
afterAll(() => db.$disconnect());
it("keeps existing game rows nullable and constrains passed attempts", async () => {
  const r = await db.gameRun.create({ data: { seed: "old", wechatId: "old", nickname: "old", tiersSnapshot: [] } });
  expect(r).toMatchObject({ game: "BIG", level: null, passedAt: null });
  await expect(db.gameRun.update({ where: { id: r.id }, data: { level: 0 } })).rejects.toThrow();
  await expect(db.gameRun.update({ where: { id: r.id }, data: { passedAt: new Date() } })).rejects.toThrow();
  await expect(db.gameRun.update({ where: { id: r.id }, data: { level: 1, passedAt: new Date() } })).rejects.toThrow();
});

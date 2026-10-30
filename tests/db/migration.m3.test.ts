import { readdirSync, readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseName, testDirectDatabaseUrl } from "./testDbUrl";

const NEW_MIGRATION = "20261030200000_game_kind_m3";
const dir = "prisma/migrations";

const baseUrl = new URL(testDirectDatabaseUrl());
const scratchName = `${databaseName(baseUrl.toString())}_m3_test`;
const scratchUrl = new URL(baseUrl);
scratchUrl.pathname = `/${scratchName}`;
const maintenanceUrl = new URL(baseUrl);
// Use the validated *_test database for scratch-database administration too.

const sqlOf = (name: string) => readFileSync(`${dir}/${name}/migration.sql`, "utf8");
let client: Client;

beforeAll(async () => {
  const admin = new Client({ connectionString: maintenanceUrl.toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${scratchName}"`);
  await admin.query(`CREATE DATABASE "${scratchName}"`);
  await admin.end();
  client = new Client({ connectionString: scratchUrl.toString() });
  await client.connect();
  const older = readdirSync(dir)
    .filter((d) => /^\d{14}_/.test(d) && d < NEW_MIGRATION)
    .sort();
  for (const name of older) await client.query(sqlOf(name));
});

afterAll(async () => {
  await client.end();
  const admin = new Client({ connectionString: maintenanceUrl.toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${scratchName}"`);
  await admin.end();
});

describe("additive M3 migration", () => {
  it("preserves existing runs, awards and prize weeks while adding M3", async () => {
    for (const game of ["BIG", "TU"]) {
      const run = await client.query(`INSERT INTO "GameRun" ("game","seed","wechatId","nickname","tiersSnapshot","score","weekKey","finishedAt")
        VALUES ($1::"GameKind",'s','wx','n','[]',10,'2026-10-19',now()) RETURNING "id"`, [game]);
      await client.query(`INSERT INTO "GameAward" ("game","weekKey","runId") VALUES ($1::"GameKind",'2026-10-19',$2)`, [game, run.rows[0].id]);
    }
    await client.query(`INSERT INTO "GamePrizeWeek" ("weekKey","game","chosenBy") VALUES ('2026-10-19','TU','OWNER')`);
    const before = await client.query(`SELECT row_to_json(r) AS row FROM "GameRun" r ORDER BY game`);
    const awards = await client.query(`SELECT row_to_json(a) AS row FROM "GameAward" a ORDER BY game`);
    await client.query(sqlOf(NEW_MIGRATION));
    expect((await client.query(`SELECT row_to_json(r) AS row FROM "GameRun" r ORDER BY game`)).rows).toEqual(before.rows);
    expect((await client.query(`SELECT row_to_json(a) AS row FROM "GameAward" a ORDER BY game`)).rows).toEqual(awards.rows);
    expect((await client.query(`SELECT game FROM "GamePrizeWeek"`)).rows).toEqual([{ game: "TU" }]);
    const run = await client.query(`INSERT INTO "GameRun" ("game","seed","wechatId","nickname","tiersSnapshot") VALUES ('M3','s','wx','n','[]') RETURNING "id"`);
    await client.query(`INSERT INTO "GameAward" ("game","weekKey","runId") VALUES ('M3','2026-10-19',$1)`, [run.rows[0].id]);
    await expect(client.query(`INSERT INTO "GameAward" ("game","weekKey","runId") VALUES ('M3','2026-10-19',$1)`, [run.rows[0].id])).rejects.toThrow();
    await client.query(`UPDATE "GamePrizeWeek" SET game = 'M3'`);
  });
});

// The 20261028120000_game_kind migration run on a seeded scratch database: existing runs and
// awards become the first game (BIG), the award is unique per (game, week), TU rows can be added.

import { readdirSync, readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseName, testDirectDatabaseUrl } from "./testDbUrl";

const NEW_MIGRATION = "20261028120000_game_kind";
const dir = "prisma/migrations";

const baseUrl = new URL(testDirectDatabaseUrl());
const scratchName = `${databaseName(baseUrl.toString())}_gk_test`;
const scratchUrl = new URL(baseUrl);
scratchUrl.pathname = `/${scratchName}`;
const maintenanceUrl = new URL(baseUrl);
maintenanceUrl.pathname = "/postgres";

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

describe("game kind migration", () => {
  it("keeps seeded runs and awards as BIG, and allows one award per game and week", async () => {
    const run = await client.query(
      `INSERT INTO "GameRun" ("seed","wechatId","nickname","tiersSnapshot","score","weekKey","finishedAt","dropCount","simSteps")
       VALUES ('s','wx','n','[]'::jsonb, 10, '2026-10-19', now(), 3, 120) RETURNING "id"`,
    );
    const runId = run.rows[0].id as string;
    await client.query(`INSERT INTO "GameAward" ("weekKey","runId") VALUES ('2026-10-19', $1)`, [runId]);
    await client.query(sqlOf(NEW_MIGRATION));

    const runs = await client.query(`SELECT "game"::text AS game, "score", "dropCount", "simSteps", "playMs", "suspicious" FROM "GameRun"`);
    expect(runs.rows).toEqual([{ game: "BIG", score: 10, dropCount: 3, simSteps: 120, playMs: null, suspicious: false }]);
    const awards = await client.query(`SELECT "game"::text AS game, "weekKey" FROM "GameAward"`);
    expect(awards.rows).toEqual([{ game: "BIG", weekKey: "2026-10-19" }]);

    const tu = await client.query(
      `INSERT INTO "GameRun" ("game","seed","wechatId","nickname","tiersSnapshot") VALUES ('TU','s','wx','n','[]'::jsonb) RETURNING "id"`,
    );
    await client.query(`INSERT INTO "GameAward" ("game","weekKey","runId") VALUES ('TU','2026-10-19',$1)`, [tu.rows[0].id]);
    await expect(client.query(`INSERT INTO "GameAward" ("weekKey","runId") VALUES ('2026-10-19',$1)`, [runId])).rejects.toThrow();
    await expect(client.query(`INSERT INTO "GameRun" ("game","seed","wechatId","nickname","tiersSnapshot") VALUES ('X','s','w','n','[]')`)).rejects.toThrow();
  });
});

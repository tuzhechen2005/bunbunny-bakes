// The 20261026140000_game_tier_name_colour migration run on a seeded scratch database:
// existing tiers keep working (NULL name / colour), the checks hold, a product delete leaves a game-only row.

import { readdirSync, readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseName, testDirectDatabaseUrl } from "./testDbUrl";

const NEW_MIGRATION = "20261026140000_game_tier_name_colour";
const dir = "prisma/migrations";

const baseUrl = new URL(testDirectDatabaseUrl());
const scratchName = `${databaseName(baseUrl.toString())}_gtm_test`;
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

describe("game tier name and colour migration", () => {
  it("keeps seeded tiers, adds nullable columns, enforces the checks, and a product delete leaves a game-only row", async () => {
    const p = await client.query(
      `INSERT INTO "Product" ("id","name","unitPriceCents","capacityMode","dailyLimit","sortOrder","updatedAt")
       VALUES (gen_random_uuid(), '奶酪角', 249, 'INDEPENDENT', 10, 1, now()) RETURNING "id"`,
    );
    const productId = p.rows[0].id as string;
    await client.query(
      `INSERT INTO "GameTier" ("id","productId","sortOrder","isBig","updatedAt") VALUES (gen_random_uuid(), $1, 0, false, now())`,
      [productId],
    );
    await client.query(sqlOf(NEW_MIGRATION));

    const seeded = await client.query(`SELECT "name","fieldColor","productId" FROM "GameTier"`);
    expect(seeded.rows).toEqual([{ name: null, fieldColor: null, productId }]);

    await client.query(
      `INSERT INTO "GameTier" ("id","productId","sortOrder","isBig","name","fieldColor","updatedAt") VALUES (gen_random_uuid(), NULL, 1, false, '泡芙', '#F0BF45', now())`,
    );
    const bad = (name: string | null, color: string | null) =>
      client.query(
        `INSERT INTO "GameTier" ("id","sortOrder","isBig","name","fieldColor","updatedAt") VALUES (gen_random_uuid(), 2, false, $1, $2, now())`,
        [name, color],
      );
    await expect(bad("一二三四五六七八九十一二三", null)).rejects.toThrow();
    await expect(bad("", null)).rejects.toThrow();
    await expect(bad("x", "red")).rejects.toThrow();
    await expect(bad("x", "#f0bf45")).rejects.toThrow();
    await expect(bad("一二三四五六七八九十一二", "#F0BF45")).resolves.toBeDefined();

    await client.query(`DELETE FROM "Product" WHERE "id" = $1`, [productId]);
    const left = await client.query(`SELECT count(*)::int AS n FROM "GameTier" WHERE "productId" IS NULL AND NOT "isBig"`);
    expect(left.rows[0].n).toBe(3);
  });
});

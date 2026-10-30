// The 20261027120000_product_pickup_weekdays migration run on a seeded database: existing
// products become "every day" ([]), and the CHECK constraint refuses bad values.
// Uses its own scratch schema next to the test one; no other database is touched.

import { readdirSync, readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseName, testDirectDatabaseUrl } from "./testDbUrl";

const NEW_MIGRATION = "20261027120000_product_pickup_weekdays";
const dir = "prisma/migrations";

const baseUrl = new URL(testDirectDatabaseUrl());
const scratchName = `${databaseName(baseUrl.toString())}_wd_test`;

const sqlOf = (name: string) => readFileSync(`${dir}/${name}/migration.sql`, "utf8");
let client: Client;

beforeAll(async () => {
  client = new Client({ connectionString: baseUrl.toString() });
  await client.connect();
  await client.query(`CREATE SCHEMA "${scratchName}"`);
  await client.query(`SET search_path TO "${scratchName}"`);
  const older = readdirSync(dir)
    .filter((d) => /^\d{14}_/.test(d) && d < NEW_MIGRATION)
    .sort();
  for (const name of older) await client.query(sqlOf(name));
});

afterAll(async () => {
  if (!client) return;
  await client.query(`DROP SCHEMA IF EXISTS "${scratchName}" CASCADE`);
  await client.end();
});

describe("product pickup weekdays migration", () => {
  it("keeps existing products orderable every day and guards the column", async () => {
    for (const [i, name] of ["奶酥红豆包", "岩烧乳酪包", "奶酪角", "焦糖布蕾"].entries()) {
      await client.query(
        `INSERT INTO "Product" ("id","name","unitPriceCents","capacityMode","dailyLimit","sortOrder","updatedAt")
         VALUES (gen_random_uuid(), $1, 249, 'INDEPENDENT', 10, $2, now())`,
        [name, i],
      );
    }

    await client.query(sqlOf(NEW_MIGRATION));

    const rows = await client.query(`SELECT "name","pickupWeekdays" FROM "Product" ORDER BY "sortOrder"`);
    expect(rows.rows.map((r) => r.pickupWeekdays)).toEqual([[], [], [], []]);

    await client.query(`UPDATE "Product" SET "pickupWeekdays" = ARRAY[3] WHERE "name" = '奶酪角'`);
    await client.query(`UPDATE "Product" SET "pickupWeekdays" = ARRAY[0,6] WHERE "name" = '焦糖布蕾'`);
    for (const bad of ["ARRAY[7]", "ARRAY[-1]", "ARRAY[0,1,2,3,4,5,6]", "ARRAY[1,NULL]::int[]"]) {
      await expect(
        client.query(`UPDATE "Product" SET "pickupWeekdays" = ${bad} WHERE "name" = '奶酥红豆包'`),
      ).rejects.toThrow(/Product_pickupWeekdays_check/);
    }
    await expect(
      client.query(`UPDATE "Product" SET "pickupWeekdays" = NULL WHERE "name" = '奶酥红豆包'`),
    ).rejects.toThrow();
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseName, testDirectDatabaseUrl } from "./testDbUrl";

const NEW_MIGRATION = "20261101120000_product_unit_label";
const dir = "prisma/migrations";

const baseUrl = new URL(testDirectDatabaseUrl());
const scratchName = `${databaseName(baseUrl.toString())}_unit_test`;
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

describe("product unit migration", () => {
  it("backfills by name and defaults future products to 个", async () => {
    for (const name of ["焦糖布蕾", "布蕾礼盒", "泡芙", "奶酪角"]) {
      await client.query(`INSERT INTO "Product" ("id","name","unitPriceCents","capacityMode","dailyLimit","updatedAt") VALUES (gen_random_uuid(), $1, 249, 'INDEPENDENT', 10, now())`, [name]);
    }
    await client.query(sqlOf(NEW_MIGRATION));
    const rows = await client.query(`SELECT "name", "unitLabel" FROM "Product"`);
    expect(Object.fromEntries(rows.rows.map(r => [r.name, r.unitLabel]))).toEqual({ "焦糖布蕾": "杯", "布蕾礼盒": "杯", "泡芙": "个", "奶酪角": "个" });
    const added = await client.query(`INSERT INTO "Product" ("id","name","unitPriceCents","capacityMode","dailyLimit","updatedAt") VALUES (gen_random_uuid(), '新布蕾', 249, 'INDEPENDENT', 10, now()) RETURNING "unitLabel"`);
    expect(added.rows[0].unitLabel).toBe("个");
    await expect(client.query(`UPDATE "Product" SET "unitLabel" = NULL`)).rejects.toThrow();
  });
});

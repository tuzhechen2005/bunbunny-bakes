// Apply F2 to a pre-flavour database containing a legacy order; verify data and constraints.
// Uses a dedicated scratch database with a validated *_test name.

import { readdirSync, readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseName, testDirectDatabaseUrl } from "./testDbUrl";

const NEW_MIGRATION = "20261102120000_flavor_limits_bundles";
const dir = "prisma/migrations";

const baseUrl = new URL(testDirectDatabaseUrl());
const scratchName = `${databaseName(baseUrl.toString())}_f2_migration_test`;
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

describe("F2 migration", () => {
  it("keeps existing flavours null and cascades date/flavour overrides", async () => {
    const productId = (await client.query(`INSERT INTO "Product" (id,name,"unitPriceCents","capacityMode","dailyLimit") VALUES (gen_random_uuid(),'legacy',450,'INDEPENDENT',24) RETURNING id`)).rows[0].id;
    const flavorId = (await client.query(`INSERT INTO "ProductFlavor" (id,"productId",name,"priceCents") VALUES (gen_random_uuid(),$1,'legacy',450) RETURNING id`, [productId])).rows[0].id;
    await client.query(sqlOf(NEW_MIGRATION));
    expect((await client.query(`SELECT "dailyLimit", "bundlePriceCents" FROM "ProductFlavor" WHERE id=$1`, [flavorId])).rows).toEqual([{ dailyLimit: null, bundlePriceCents: null }]);
    await client.query(`INSERT INTO "OpenDate" (date) VALUES ('2026-11-04'), ('2026-11-05')`);
    await client.query(`INSERT INTO "OpenDateFlavorLimit" (date,"flavorId", "limit") VALUES ('2026-11-04',$1,0), ('2026-11-05',$1,2)`, [flavorId]);
    await expect(client.query(`UPDATE "ProductFlavor" SET "dailyLimit"=-1 WHERE id=$1`, [flavorId])).rejects.toThrow();
    await expect(client.query(`UPDATE "ProductFlavor" SET "bundlePriceCents"=0 WHERE id=$1`, [flavorId])).rejects.toThrow();
    await expect(client.query(`UPDATE "OpenDateFlavorLimit" SET "limit"=-1`)).rejects.toThrow();
    await client.query(`DELETE FROM "OpenDate" WHERE date='2026-11-04'`);
    expect((await client.query(`SELECT * FROM "OpenDateFlavorLimit"`)).rows).toHaveLength(1);
    await client.query(`DELETE FROM "ProductFlavor" WHERE id=$1`, [flavorId]);
    expect((await client.query(`SELECT * FROM "OpenDateFlavorLimit"`)).rows).toHaveLength(0);
  });
});

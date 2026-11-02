// Apply F1 to a pre-flavour database containing a legacy order; verify data and constraints.
// Uses a dedicated scratch database with a validated *_test name.

import { readdirSync, readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseName, testDirectDatabaseUrl } from "./testDbUrl";

const NEW_MIGRATION = "20261101200000_product_flavors";
const dir = "prisma/migrations";

const baseUrl = new URL(testDirectDatabaseUrl());
const scratchName = `${databaseName(baseUrl.toString())}_flavor_migration_test`;
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

describe("flavour migration", () => {
  it("preserves legacy items and enforces ownership, null uniqueness and deletion restrictions", async () => {
    const p = (await client.query(`INSERT INTO "Product" (id,name,"unitPriceCents","capacityMode","dailyLimit") VALUES (gen_random_uuid(),'legacy',299,'INDEPENDENT',24) RETURNING id`)).rows[0].id;
    const other = (await client.query(`INSERT INTO "Product" (id,name,"unitPriceCents","capacityMode","dailyLimit") VALUES (gen_random_uuid(),'other',199,'INDEPENDENT',24) RETURNING id`)).rows[0].id;
    await client.query(`INSERT INTO "OpenDate" (date) VALUES ('2026-11-04')`);
    const o = (await client.query(`INSERT INTO "Order" (id,"pickupDate",seq,"orderNo","viewToken","wechatId",fulfillment,"subtotalCents","deliveryFeeCents","totalCents","cutoffAt",source) VALUES (gen_random_uuid(),'2026-11-04',1,'1104-001','token','wx','PICKUP',299,0,299,now(),'WEB') RETURNING id`)).rows[0].id;
    const insert = `INSERT INTO "OrderItem" (id,"orderId","productId","nameSnapshot",qty,"unitPriceCents","bundleSize","lineTotalCents") VALUES (gen_random_uuid(),$1,$2,'legacy',1,299,4,299)`;
    await client.query(insert, [o,p]);
    await client.query(sqlOf(NEW_MIGRATION));
    expect((await client.query(`SELECT "flavorId","flavorName","unitPriceCents" FROM "OrderItem"`)).rows).toEqual([{ flavorId: null, flavorName: null, unitPriceCents: 299 }]);
    await expect(client.query(insert,[o,p])).rejects.toThrow(/unique/);
    const f = (await client.query(`INSERT INTO "ProductFlavor" (id,"productId",name,"priceCents") VALUES (gen_random_uuid(),$1,'原味',300) RETURNING id`, [p])).rows[0].id;
    await expect(client.query(`UPDATE "ProductFlavor" SET name = repeat('x',13) WHERE id=$1`,[f])).rejects.toThrow(/name_check/);
    await expect(client.query(`UPDATE "ProductFlavor" SET "priceCents"=-1 WHERE id=$1`,[f])).rejects.toThrow(/priceCents_check/);
    await client.query(`UPDATE "OrderItem" SET "flavorId"=$1,"flavorName"='原味'`,[f]);
    await expect(client.query(`UPDATE "OrderItem" SET "productId"=$1`,[other])).rejects.toThrow(/foreign key/);
    await expect(client.query(`DELETE FROM "ProductFlavor" WHERE id=$1`,[f])).rejects.toThrow(/foreign key/);
    await client.query(insert,[o,p]); // a legacy line and a flavoured line can coexist
    await expect(client.query(`UPDATE "OrderItem" SET "flavorId"=$1 WHERE "flavorId" IS NULL`,[f])).rejects.toThrow(/unique/);
    expect((await client.query(`SELECT count(*)::int n FROM "OrderItem"`)).rows[0].n).toBe(2);
  });
});

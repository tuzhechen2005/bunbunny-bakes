// The 20261026120000_product_colour_and_photos migration run on a seeded database:
// covers become the first ProductImage, the existing products keep their colours (by name).
// Uses its own scratch database next to the test one; no other database is touched.

import { readdirSync, readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseName, testDirectDatabaseUrl } from "./testDbUrl";

const NEW_MIGRATION = "20261026120000_product_colour_and_photos";
const dir = "prisma/migrations";

const baseUrl = new URL(testDirectDatabaseUrl());
const scratchName = `${databaseName(baseUrl.toString())}_mig_test`;
const scratchUrl = new URL(baseUrl);
scratchUrl.pathname = `/${scratchName}`;
const maintenanceUrl = new URL(baseUrl);
maintenanceUrl.pathname = "/postgres";

const sqlOf = (name: string) => readFileSync(`${dir}/${name}/migration.sql`, "utf8");
let client: Client;

async function insertProduct(name: string, imageUrl: string | null, sortOrder: number) {
  const r = await client.query(
    `INSERT INTO "Product" ("id","name","imageUrl","unitPriceCents","capacityMode","dailyLimit","sortOrder","updatedAt")
     VALUES (gen_random_uuid(), $1, $2, 249, 'INDEPENDENT', 10, $3, now()) RETURNING "id"`,
    [name, imageUrl, sortOrder],
  );
  return r.rows[0].id as string;
}

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

describe("product colour and photos migration", () => {
  it("maps covers to photos and the known products to their colours; unknown names stay null", async () => {
    const url = (n: string) => `/api/images/11111111-1111-4111-8111-111111111111/${n.repeat(32)}.jpg`;
    const withPhoto = await insertProduct("奶酥红豆包", url("a"), 1);
    const noPhoto = await insertProduct("岩烧乳酪包", null, 2);
    await insertProduct("奶酪角", url("b"), 3);
    await insertProduct("焦糖布蕾", null, 4);
    await insertProduct("巧克力奶酥吐司", url("c"), 5);
    const custom = await insertProduct("新来的面包", url("d"), 6);

    await client.query(sqlOf(NEW_MIGRATION));

    const colours = await client.query(`SELECT "name","fieldColor" FROM "Product" ORDER BY "sortOrder"`);
    expect(colours.rows.map((r) => [r.name, r.fieldColor])).toEqual([
      ["奶酥红豆包", "#DCC5BB"],
      ["岩烧乳酪包", "#F0BF45"],
      ["奶酪角", "#CFDDEA"],
      ["焦糖布蕾", "#B05219"],
      ["巧克力奶酥吐司", "#5A3A2A"],
      ["新来的面包", null],
    ]);

    const images = await client.query(`SELECT "productId","url","sortOrder" FROM "ProductImage" ORDER BY "url"`);
    expect(images.rows).toHaveLength(4);
    expect(images.rows.every((r) => r.sortOrder === 0)).toBe(true);
    expect(images.rows.find((r) => r.productId === withPhoto)?.url).toBe(url("a"));
    expect(images.rows.find((r) => r.productId === custom)?.url).toBe(url("d"));
    expect(images.rows.some((r) => r.productId === noPhoto)).toBe(false);

    // Product.imageUrl is untouched: it stays the denormalised cover.
    const covers = await client.query(`SELECT "imageUrl" FROM "Product" WHERE "id" = $1`, [withPhoto]);
    expect(covers.rows[0].imageUrl).toBe(url("a"));
  });

  it("photos cascade with their product and the colour check holds", async () => {
    const id = await insertProduct("临时", "/api/images/x", 9);
    await client.query(`INSERT INTO "ProductImage" ("id","productId","url","sortOrder") VALUES (gen_random_uuid(), $1, 'u', 0)`, [id]);
    await expect(client.query(`UPDATE "Product" SET "fieldColor" = 'blue' WHERE "id" = $1`, [id])).rejects.toThrow();
    await client.query(`DELETE FROM "Product" WHERE "id" = $1`, [id]);
    const left = await client.query(`SELECT count(*)::int AS n FROM "ProductImage" WHERE "productId" = $1`, [id]);
    expect(left.rows[0].n).toBe(0);
  });
});

import { readFileSync } from "node:fs";
import { afterAll, expect, it } from "vitest";
import { Client } from "pg";
import { testDirectDatabaseUrl } from "./testDbUrl";

const client = new Client({ connectionString: testDirectDatabaseUrl() });
afterAll(async () => { await client.end(); });

it("adds a nullable expiry without backfilling existing products", async () => {
  await client.connect();
  await client.query("BEGIN");
  try {
    // A temporary table shadows Product for this connection, leaving the migrated
    // shared schema intact while exercising the exact migration on an older row.
    await client.query('CREATE TEMP TABLE "Product" (id integer PRIMARY KEY) ON COMMIT DROP');
    await client.query('INSERT INTO "Product" (id) VALUES (1)');
    await client.query(readFileSync("prisma/migrations/20261102120000_product_new_until/migration.sql", "utf8"));
    await client.query('INSERT INTO "Product" (id) VALUES (2)');
    expect((await client.query('SELECT "newUntil" FROM "Product" ORDER BY id')).rows)
      .toEqual([{ newUntil: null }, { newUntil: null }]);
  } finally {
    await client.query("ROLLBACK");
  }
});

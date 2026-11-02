import { readFileSync } from "node:fs";
import { Client } from "pg";
import { expect, it } from "vitest";
import { testDirectDatabaseUrl } from "./testDbUrl";

it("economy migration preserves old data and enforces immutable ledger and inventory constraints", async () => {
  const client = new Client({ connectionString: testDirectDatabaseUrl() });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE SCHEMA economy_migration_test');
    await client.query('SET LOCAL search_path TO economy_migration_test');
    await client.query('CREATE TABLE existing (id int); INSERT INTO existing VALUES (7)');
    await client.query(readFileSync("prisma/migrations/20261101190000_coin_economy/migration.sql", "utf8"));
    expect((await client.query('SELECT * FROM existing')).rows).toEqual([{ id: 7 }]);
    await client.query(`INSERT INTO "CoinLedger" ("wechatIdNorm",delta,reason,"refId") VALUES ('wx',10,'ORDER','o')`);
    for (const sql of [
      `UPDATE "CoinLedger" SET delta=100`,
      `DELETE FROM "CoinLedger"`,
      `INSERT INTO "CoinLedger" ("wechatIdNorm",delta,reason,"refId") VALUES ('wx',10,'ORDER','o')`,
      `INSERT INTO "Inventory" VALUES ('wx','bomb',-1)`,
      `INSERT INTO "Inventory" VALUES (' WX ','bomb',1)`,
    ]) {
      await client.query('SAVEPOINT invalid');
      await expect(client.query(sql)).rejects.toThrow();
      await client.query('ROLLBACK TO SAVEPOINT invalid');
    }
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});

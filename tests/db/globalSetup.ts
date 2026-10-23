// Vitest globalSetup for the db project: create the test database if missing,
// then apply migrations to it with `prisma migrate deploy`.

import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { databaseName, testDatabaseUrl, testDirectDatabaseUrl } from "./testDbUrl";

export default async function setup(): Promise<void> {
  const url = testDatabaseUrl();
  // Migrations take a session-level advisory lock: they need a direct (non-pooled) connection.
  const directUrl = testDirectDatabaseUrl();
  const dbName = databaseName(url); // restricted to [A-Za-z0-9_]+_test by testDatabaseUrl()

  const maintenance = new URL(directUrl);
  maintenance.pathname = "/postgres";
  const client = new Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      dbName,
    ]);
    if (!rowCount) {
      try {
        await client.query(`CREATE DATABASE "${dbName}"`);
      } catch (e) {
        // Another run created it concurrently: fine.
        if ((e as { code?: string }).code !== "42P04") throw e;
      }
    }
  } finally {
    await client.end();
  }

  // prisma.config.ts reads DIRECT_URL || DATABASE_URL. Both are set explicitly, and
  // process.loadEnvFile() there does not override variables that are already set.
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: directUrl },
  });
}

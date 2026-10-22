import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

// The db project only ever talks to the *_test database. DATABASE_URL/DIRECT_URL are
// overridden too, so code that uses the app singleton (src/server/db.ts) hits it as well.
// tests/db/globalSetup.ts refuses to run unless the database name ends in "_test"
// (same default as tests/db/testDbUrl.ts).
const testDbUrl =
  process.env.TEST_DATABASE_URL || "postgresql://bunbunny:bunbunny@localhost:5432/bunbunny_test";

export default defineConfig({
  resolve: { alias },
  test: {
    passWithNoTests: true,
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "db",
          environment: "node",
          include: ["tests/db/**/*.test.ts"],
          // Tests share one real Postgres database: run files one at a time.
          fileParallelism: false,
          globalSetup: ["tests/db/globalSetup.ts"],
          env: {
            TEST_DATABASE_URL: testDbUrl,
            DATABASE_URL: testDbUrl,
            DIRECT_URL: testDbUrl,
          },
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});

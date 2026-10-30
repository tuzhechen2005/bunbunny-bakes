// The db test project's database. Never the dev database (guarded below).

export const DEFAULT_TEST_DATABASE_URL =
  "postgresql://bunbunny:bunbunny@localhost:5432/bunbunny_test";

/** Database name of a postgres URL. */
export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

function checkTestDb(url: string, envName: string): string {
  const name = databaseName(url);
  const host = new URL(url).hostname;
  const assignedLocalDb = name === "bunbunny_codex_s4" && ["localhost", "127.0.0.1", "[::1]"].includes(host);
  if (!/^[A-Za-z0-9_]+_test$/.test(name) && !assignedLocalDb) {
    throw new Error(
      `Refusing to run db tests against "${name}" (${envName}): use a *_test database or the assigned local S4 database.`,
    );
  }
  return url;
}

/** TEST_DATABASE_URL (or the default), after checking it names a `*_test` database. */
export function testDatabaseUrl(): string {
  return checkTestDb(process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL, "TEST_DATABASE_URL");
}

/**
 * URL for the Prisma CLI (migrate deploy/status, db seed): TEST_DIRECT_DATABASE_URL when set,
 * else the test URL. Against Neon, TEST_DATABASE_URL may be the pooled (PgBouncer transaction
 * mode) URL while migrations need the direct one, exactly like DATABASE_URL/DIRECT_URL in
 * production. Must name the same `*_test` database.
 */
export function testDirectDatabaseUrl(): string {
  const direct = process.env.TEST_DIRECT_DATABASE_URL;
  if (!direct) return testDatabaseUrl();
  checkTestDb(direct, "TEST_DIRECT_DATABASE_URL");
  if (databaseName(direct) !== databaseName(testDatabaseUrl())) {
    throw new Error("TEST_DIRECT_DATABASE_URL must name the same database as TEST_DATABASE_URL");
  }
  return direct;
}

/**
 * Multiplier for explicit db-test timeouts (DB_TEST_TIMEOUT_SCALE, default 1). Local Docker
 * runs keep the original values; a remote database (e.g. Neon over the internet, ~20-40 ms
 * per round trip) needs more wall time for the same number of queries.
 */
export function timeoutScale(): number {
  const raw = process.env.DB_TEST_TIMEOUT_SCALE;
  if (!raw) return 1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`DB_TEST_TIMEOUT_SCALE must be a number >= 1 (got "${raw}")`);
  }
  return n;
}

/** `ms` scaled by DB_TEST_TIMEOUT_SCALE. Use for per-test timeouts in tests/db. */
export function dbTimeout(ms: number): number {
  return Math.round(ms * timeoutScale());
}

/**
 * DB_TEST_REMOTE=1: the test database is reached over the internet. Tests whose premise is a
 * local, low-latency server (sub-second connect timeouts, CLI against a pooled URL) skip.
 */
export const DB_TEST_REMOTE = process.env.DB_TEST_REMOTE === "1";

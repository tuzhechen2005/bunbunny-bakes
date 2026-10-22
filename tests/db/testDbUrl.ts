// The db test project's database. Never the dev database (guarded below).

export const DEFAULT_TEST_DATABASE_URL =
  "postgresql://bunbunny:bunbunny@localhost:5432/bunbunny_test";

/** Database name of a postgres URL. */
export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

/** TEST_DATABASE_URL (or the default), after checking it names a `*_test` database. */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
  const name = databaseName(url);
  if (!/^[A-Za-z0-9_]+_test$/.test(name)) {
    throw new Error(
      `Refusing to run db tests against "${name}": the test database name must end in "_test".`,
    );
  }
  return url;
}

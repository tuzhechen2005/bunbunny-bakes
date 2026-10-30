import { afterEach, expect, it, vi } from "vitest";
import { testDatabaseUrl, testDirectDatabaseUrl } from "../db/testDbUrl";

afterEach(() => vi.unstubAllEnvs());

it("allows only names with the test suffix", () => {
  for (const name of ["bunbunny_codex_s4_test", "bunbunny_test"]) {
    const url = `postgresql://localhost:5432/${name}`;
    vi.stubEnv("TEST_DATABASE_URL", url);
    expect(testDatabaseUrl()).toBe(url);
  }
});

it("refuses non-test names on every host and mismatched direct databases", () => {
  for (const url of [
    "postgresql://localhost/bunbunny", "postgresql://localhost/bunbunny_qa",
    "postgresql://localhost/production", "postgresql://localhost/bunbunny_codex_s4",
    "postgresql://127.0.0.1/bunbunny_codex_s4", "postgresql://[::1]/bunbunny_codex_s4",
    "postgresql://localhost/bad-name_test", "postgresql://localhost/_test", "postgresql://remote.example/bunbunny_codex_s4",
  ]) {
    vi.stubEnv("TEST_DATABASE_URL", url);
    expect(() => testDatabaseUrl()).toThrow(/Refusing/);
  }
  vi.stubEnv("TEST_DATABASE_URL", "postgresql://localhost/bunbunny_codex_s4_test");
  vi.stubEnv("TEST_DIRECT_DATABASE_URL", "postgresql://localhost/other_test");
  expect(() => testDirectDatabaseUrl()).toThrow(/same database/);
});

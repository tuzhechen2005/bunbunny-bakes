import { defineConfig } from "prisma/config";

// Load .env for the Prisma CLI without adding dotenv (Node >= 20.12).
// On Vercel/CI the variables come from the environment and there is no .env.
try {
  process.loadEnvFile();
} catch {
  // no .env file: rely on the process environment
}

// The CLI (migrate, db push, studio) needs a direct, non-pooled connection.
// DIRECT_URL is the Neon direct URL; locally it can equal DATABASE_URL.
// The app runtime connects with DATABASE_URL (pooled) via a driver adapter.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DIRECT_URL"] || process.env["DATABASE_URL"],
  },
});

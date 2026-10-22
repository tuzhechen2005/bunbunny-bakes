// Prisma client for the app runtime (Prisma 7 + node-postgres driver adapter).
// The runtime connects with DATABASE_URL (pooled on Neon); migrations use DIRECT_URL
// via prisma.config.ts.

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

export type DbClient = InstanceType<typeof PrismaClient>;

/** Interactive-transaction client, as passed to `prisma.$transaction(async (tx) => …)`. */
export type Tx = Prisma.TransactionClient;

/** A new client for `url`. Tests use this with TEST_DATABASE_URL; call `$disconnect()` when done. */
export function createPrismaClient(url: string): DbClient {
  if (!url) throw new Error("createPrismaClient: database URL is empty");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

const globalForPrisma = globalThis as unknown as { __bunbunnyPrisma?: DbClient };

function getClient(): DbClient {
  if (!globalForPrisma.__bunbunnyPrisma) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    // Kept on globalThis so Next.js dev hot reloads reuse one pool instead of leaking.
    globalForPrisma.__bunbunnyPrisma = createPrismaClient(url);
  }
  return globalForPrisma.__bunbunnyPrisma;
}

/**
 * The app-wide client. Created lazily on first use, so importing this module
 * (e.g. during `next build`) does not require DATABASE_URL.
 */
export const prisma: DbClient = new Proxy({} as DbClient, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

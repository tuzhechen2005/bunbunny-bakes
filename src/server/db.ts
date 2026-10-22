// Prisma client for the app runtime (Prisma 7 + node-postgres driver adapter).
// The runtime connects with DATABASE_URL (pooled on Neon); migrations use DIRECT_URL
// via prisma.config.ts.

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

export type DbClient = InstanceType<typeof PrismaClient>;

/**
 * Interactive-transaction client, as passed to `prisma.$transaction(async (tx) => …)`.
 * The `$connect?: never` brand rejects the root client: `Prisma.TransactionClient` alone
 * is structurally satisfied by it, and a FOR UPDATE outside a transaction autocommits
 * (the lock is released at once). Guarded by tests/db/txType.test.ts.
 */
export type Tx = Prisma.TransactionClient & { $connect?: never };

/** How long a query waits for a free pool connection before failing (pg default: forever). */
export const DEFAULT_CONNECTION_TIMEOUT_MS = 5000;

export interface CreatePrismaClientOptions {
  /** Max connections in the node-postgres pool (pg default: 10). */
  max?: number;
  /** Default DEFAULT_CONNECTION_TIMEOUT_MS. */
  connectionTimeoutMillis?: number;
}

/** A new client for `url`. Tests use this with TEST_DATABASE_URL; call `$disconnect()` when done. */
export function createPrismaClient(url: string, options: CreatePrismaClientOptions = {}): DbClient {
  if (!url) throw new Error("createPrismaClient: database URL is empty");
  if (options.max !== undefined && (!Number.isInteger(options.max) || options.max < 1)) {
    throw new Error(`createPrismaClient: max must be a positive integer (got ${options.max})`);
  }
  const connectionTimeoutMillis = options.connectionTimeoutMillis ?? DEFAULT_CONNECTION_TIMEOUT_MS;
  if (!Number.isInteger(connectionTimeoutMillis) || connectionTimeoutMillis < 1) {
    throw new Error(
      `createPrismaClient: connectionTimeoutMillis must be a positive integer (got ${connectionTimeoutMillis})`,
    );
  }
  const adapter = new PrismaPg({
    connectionString: url,
    connectionTimeoutMillis,
    ...(options.max !== undefined ? { max: options.max } : {}),
  });
  return new PrismaClient({ adapter });
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

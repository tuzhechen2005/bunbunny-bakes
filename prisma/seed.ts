// Idempotent seed: `npm run db:seed` (prisma db seed -> tsx prisma/seed.ts).
// - Setting row with schema defaults (never overwrites existing values).
// - The four default products, only if there are no products at all.
// - The admin user from ADMIN_USERNAME / ADMIN_INITIAL_PASSWORD, only if no admin exists.
// The password is never printed.

import { pathToFileURL } from "node:url";
import { hash, type Algorithm } from "@node-rs/argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

type Client = InstanceType<typeof PrismaClient>;

const MIN_PASSWORD_LENGTH = 10;
/** Algorithm.Argon2id (a const enum, which isolatedModules cannot reference). */
const ARGON2ID = 2 as Algorithm;

const PLACEHOLDER_DESCRIPTION = "简介待补充";

/** CAPACITY_RULES.md §2.3 (prices) and §3.1 (capacity parameters). */
export const DEFAULT_PRODUCTS = [
  {
    name: "奶酥红豆包",
    unitPriceCents: 249,
    bundleSize: 4,
    bundlePriceCents: 899,
    capacityMode: "DOUGH_PER_UNIT",
    doughG: 70,
    leadDays: 1,
    sortOrder: 1,
    fieldColor: "#DCC5BB",
  },
  {
    name: "岩烧乳酪包",
    unitPriceCents: 249,
    bundleSize: 4,
    bundlePriceCents: 899,
    capacityMode: "DOUGH_PER_UNIT",
    doughG: 70,
    leadDays: 1,
    sortOrder: 2,
    fieldColor: "#F0BF45",
  },
  {
    name: "奶酪角",
    unitPriceCents: 299,
    bundleSize: 4,
    bundlePriceCents: 1099,
    capacityMode: "DOUGH_PER_ROUND",
    roundG: 340,
    piecesPerRound: 4,
    leadDays: 1,
    sortOrder: 3,
    fieldColor: "#CFDDEA",
  },
  {
    name: "焦糖布蕾",
    unitPriceCents: 249,
    bundleSize: 4,
    bundlePriceCents: 899,
    capacityMode: "INDEPENDENT",
    dailyLimit: 24,
    batchYield: 3,
    leadDays: 2,
    sortOrder: 4,
    fieldColor: "#B05219",
  },
] as const;

export interface SeedEnv {
  ADMIN_USERNAME?: string;
  ADMIN_INITIAL_PASSWORD?: string;
}

export interface SeedResult {
  settingCreated: boolean;
  productsCreated: number;
  adminCreated: boolean;
}

export async function seed(prisma: Client, env: SeedEnv): Promise<SeedResult> {
  // Validate and hash before opening the transaction (hashing is slow).
  const adminExists = (await prisma.adminUser.count()) > 0;
  let admin: { username: string; passwordHash: string } | null = null;
  if (!adminExists) {
    const username = env.ADMIN_USERNAME?.trim() ?? "";
    const password = env.ADMIN_INITIAL_PASSWORD ?? "";
    if (!username) throw new Error("seed: ADMIN_USERNAME is required to create the admin user");
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(
        `seed: ADMIN_INITIAL_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
    }
    admin = { username, passwordHash: await hash(password, { algorithm: ARGON2ID }) };
  }

  return prisma.$transaction(async (tx) => {
    const settingCreated = (await tx.setting.count()) === 0;
    // update: {} keeps whatever the owner changed.
    await tx.setting.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });

    let productsCreated = 0;
    if ((await tx.product.count()) === 0) {
      for (const p of DEFAULT_PRODUCTS) {
        await tx.product.create({
          data: { ...p, description: PLACEHOLDER_DESCRIPTION, status: "ACTIVE" },
        });
        productsCreated += 1;
      }
    }

    let adminCreated = false;
    if (admin && (await tx.adminUser.count()) === 0) {
      await tx.adminUser.create({ data: admin });
      adminCreated = true;
    }

    return { settingCreated, productsCreated, adminCreated };
  });
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // no .env: rely on the environment
  }
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("seed: DATABASE_URL (or DIRECT_URL) is not set");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const result = await seed(prisma, {
      ADMIN_USERNAME: process.env.ADMIN_USERNAME,
      ADMIN_INITIAL_PASSWORD: process.env.ADMIN_INITIAL_PASSWORD,
    });
    console.log(
      `seed: setting ${result.settingCreated ? "created" : "kept"}; ` +
        `${result.productsCreated} product(s) created; ` +
        `admin ${result.adminCreated ? "created" : "kept"}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}

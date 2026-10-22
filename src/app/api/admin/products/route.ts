import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { createProduct, listProducts } from "@/server/products";

export const GET = adminHandler(async () => {
  return Response.json({ products: await listProducts(prisma) });
});

export const POST = adminHandler(async ({ request, now }) => {
  const body: unknown = await request.json().catch(() => null);
  const product = await createProduct(prisma, body, now);
  return Response.json({ product }, { status: 201 });
});

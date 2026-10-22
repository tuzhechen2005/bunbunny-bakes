// GET /api/admin/order-form: products, open dates with usage, and fees for the order forms.

import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { loadOrderFormData } from "@/server/orderForm";

export const GET = adminHandler(async ({ now }) => Response.json(await loadOrderFormData(prisma, now)));

// Wrapper for every /api/admin/** route handler (SECURITY.md §3): Origin check for
// non-GET requests, a database-validated session, then the handler. Errors become
// API_SPEC §1 JSON; nothing unexpected (stack traces, database errors) is returned.

import { ZodError, type z } from "zod";
import type { AdminSessionInfo } from "./auth";
import { AppError } from "./errors";
import { revalidateMenu } from "./menuCache";
import { issuesToFields } from "./orderSchemas";
import { checkOrigin } from "./origin";
import { errorResponse, requireAdmin } from "./session";

type Params = Record<string, string | string[]>;

export interface AdminHandlerArgs<P extends Params = Record<string, string>> {
  request: Request;
  /** Resolved dynamic route params (empty object for routes without any). */
  params: P;
  admin: AdminSessionInfo;
  /** The request time, read once after connection(); pass it down. */
  now: Date;
}

/** Next route handler context: `params` is a promise in Next 16. */
interface RouteContext<P> {
  params?: Promise<P>;
}

/**
 * `export const POST = adminHandler(async ({ request, admin, now }) => Response.json(...))`.
 * Order: Origin check (non-GET/HEAD) -> requireAdmin() -> handler. Thrown AppError /
 * ZodError / unknown errors are mapped with errorResponse().
 */
export function adminHandler<P extends Params = Record<string, string>>(
  fn: (args: AdminHandlerArgs<P>) => Promise<Response> | Response,
): (request: Request, context?: RouteContext<P>) => Promise<Response> {
  return async (request, context) => {
    try {
      const method = request.method.toUpperCase();
      if (method !== "GET" && method !== "HEAD") {
        const forbidden = checkOrigin(request);
        if (forbidden) return forbidden;
      }
      const { session, now } = await requireAdmin();
      const params = (context?.params ? await context.params : {}) as P;
      const response = await fn({ request, params, admin: session, now });
      // Any successful admin write may change the menu (product, photo, price, ordering switch):
      // the home page's cached copy (src/server/menuCache.ts) must not outlive it.
      if (method !== "GET" && method !== "HEAD" && response.ok) revalidateMenu();
      return response;
    } catch (e) {
      if (e instanceof ZodError) {
        return errorResponse(new AppError("VALIDATION", { extra: { fields: issuesToFields(e) } }));
      }
      return errorResponse(e);
    }
  };
}

/** Parses the query string of a GET request with a Zod schema; throws AppError VALIDATION otherwise. */
export function parseQuery<T extends z.ZodType>(request: Request, schema: T): z.output<T> {
  const { searchParams } = new URL(request.url);
  const raw: Record<string, string | string[]> = {};
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key);
    raw[key] = values.length > 1 ? values : values[0];
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new AppError("VALIDATION", { extra: { fields: issuesToFields(result.error) } });
  }
  return result.data;
}

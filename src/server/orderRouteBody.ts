// Shared by the admin order routes: the JSON body as a plain object.

import { AppError } from "./errors";

/** The request's JSON body, which must be an object; otherwise AppError VALIDATION. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError("VALIDATION", { extra: { fields: { _: "Invalid JSON" } } });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError("VALIDATION", { extra: { fields: { _: "Expected an object" } } });
  }
  return body as Record<string, unknown>;
}

// Application errors with the API error codes of docs/API_SPEC.md §1.
// Route handlers turn an AppError into `{ error: code, message, ...extra }`
// with `httpStatus`.

import { copy } from "@/copy";

export const ERROR_HTTP_STATUS = {
  VALIDATION: 422,
  ORDERING_DISABLED: 409,
  DATE_CLOSED: 409,
  CUTOFF_PASSED: 409,
  PRODUCT_UNAVAILABLE: 409,
  QTY_LIMIT: 409,
  FULL: 409,
  DELIVERY_FULL: 409,
  WEEKDAY_UNAVAILABLE: 409,
  RATE_LIMITED: 429,
  NOT_CANCELLABLE: 409,
  OVER_LIMIT: 409,
  STALE: 409,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
} as const;

export type ErrorCode = keyof typeof ERROR_HTTP_STATUS;

export const ERROR_CODES = Object.keys(ERROR_HTTP_STATUS) as ErrorCode[];

/** Extra response fields, e.g. `fields` (VALIDATION), `suggestion` (FULL), `violations` (OVER_LIMIT). */
export type ErrorExtra = Record<string, unknown>;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly extra?: ErrorExtra;

  constructor(code: ErrorCode, options: { message?: string; extra?: ErrorExtra; cause?: unknown } = {}) {
    super(options.message ?? copy.errors[code], { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.httpStatus = ERROR_HTTP_STATUS[code];
    this.extra = options.extra;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

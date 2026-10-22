// Admin authentication (SECURITY.md §3): argon2id passwords, lockout, DB-backed
// sessions, password reset and change. Every function takes the db client and `now`
// (the caller reads the clock); nothing here touches cookies or HTTP.

import { createHash, randomBytes } from "node:crypto";
import { hash, verify, type Algorithm } from "@node-rs/argon2";
import { copy } from "@/copy";
import type { DbClient, Tx } from "./db";
import { AppError } from "./errors";
import { writeAudit } from "./audit";
import { enqueueNotification } from "./outbox";

/** Algorithm.Argon2id (a const enum, which isolatedModules cannot reference). */
const ARGON2ID = 2 as Algorithm;

export const MIN_PASSWORD_LENGTH = 10;
/** Upper bound on accepted password input, so a huge body cannot make hashing expensive. */
export const MAX_PASSWORD_LENGTH = 256;
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
export const RESET_TTL_MS = 15 * 60 * 1000;
export const RESET_RATE_LIMIT = 3;
export const RESET_RATE_WINDOW_MS = 60 * 60 * 1000;
export const RESET_RATE_LIMIT_KEY = "password_reset";

/** 32 random bytes, base64url (43 characters). */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** sha256 hex of a token: the only form stored in the database. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, { algorithm: ARGON2ID });
}

async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // Malformed stored hash: treat as a mismatch, never surface the error.
    return false;
  }
}

// Hash of a random secret, used to spend the same time on unknown usernames.
// Created once per process with the same parameters as real hashes.
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(newToken());
  return dummyHash;
}

function invalidCredentials(): AppError {
  return new AppError("UNAUTHORIZED", { message: copy.admin.auth.invalidCredentials });
}

function assertNewPassword(newPassword: string, field = "newPassword"): void {
  if (newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > MAX_PASSWORD_LENGTH) {
    throw new AppError("VALIDATION", {
      message: copy.admin.auth.passwordTooShort,
      extra: { fields: { [field]: copy.admin.auth.passwordTooShort } },
    });
  }
}

// ---------------------------------------------------------------------------
// Sessions

export interface AdminSessionInfo {
  sessionId: string;
  userId: string;
  username: string;
  tokenHash: string;
  expiresAt: Date;
}

/** Creates a session row and returns the raw token (for the cookie only). */
export async function createSession(
  tx: Tx | DbClient,
  userId: string,
  now: Date,
): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await tx.adminSession.create({
    data: { tokenHash: hashToken(token), userId, createdAt: now, expiresAt, lastSeenAt: now },
  });
  return { token, expiresAt };
}

/** The session for a raw cookie token, or null if missing/expired. Touches lastSeenAt at most every 5 min. */
export async function getSession(
  db: DbClient,
  token: string | null | undefined,
  now: Date,
): Promise<AdminSessionInfo | null> {
  if (!token || token.length > 128) return null;
  const tokenHash = hashToken(token);
  const session = await db.adminSession.findUnique({
    where: { tokenHash },
    include: { user: { select: { username: true } } },
  });
  if (!session || session.expiresAt.getTime() <= now.getTime()) return null;
  if (now.getTime() - session.lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS) {
    // updateMany: no error if the session was deleted in between.
    await db.adminSession.updateMany({ where: { id: session.id }, data: { lastSeenAt: now } });
  }
  return {
    sessionId: session.id,
    userId: session.userId,
    username: session.user.username,
    tokenHash,
    expiresAt: session.expiresAt,
  };
}

/** Deletes the session of a raw cookie token (no-op if unknown). */
export async function logout(db: DbClient, token: string | null | undefined): Promise<void> {
  if (!token || token.length > 128) return;
  await db.adminSession.deleteMany({ where: { tokenHash: hashToken(token) } });
}

// ---------------------------------------------------------------------------
// Login

export interface LoginInput {
  username: string;
  password: string;
  /** Accepted for future rate limiting; never stored (SECURITY.md §1: IPs only as hashes). */
  ip?: string | null;
  now: Date;
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  userId: string;
}

type LoginOutcome =
  | { ok: true; result: LoginResult }
  | { ok: false };

/**
 * Verifies the credentials. Every failure (unknown user, wrong password, locked)
 * throws the same UNAUTHORIZED error. 5 consecutive failures lock the user for 15 min;
 * while locked even the right password fails. An expired lock starts a fresh count.
 */
export async function login(db: DbClient, input: LoginInput): Promise<LoginResult> {
  const { username, password, now } = input;
  const user = await db.adminUser.findUnique({ where: { username }, select: { id: true, passwordHash: true } });
  // Always run one verify, against a dummy hash for unknown users (timing).
  const passwordOk = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), password);

  const outcome = await db.$transaction(async (tx): Promise<LoginOutcome> => {
    if (!user) {
      await writeAudit(tx, {
        actor: "SYSTEM",
        action: "admin.login_failed",
        entityType: "AdminUser",
        entityId: "unknown",
        after: { username },
        reason: "unknown_user",
        at: now,
      });
      return { ok: false };
    }

    // Lock the row so concurrent attempts count correctly.
    const rows = await tx.$queryRaw<{ failedCount: number; lockedUntil: Date | null }[]>`
      SELECT "failedCount", "lockedUntil" FROM "AdminUser" WHERE "id" = ${user.id}::uuid FOR UPDATE`;
    const row = rows[0];
    if (!row) return { ok: false };

    const locked = row.lockedUntil !== null && row.lockedUntil.getTime() > now.getTime();
    if (locked) {
      await writeAudit(tx, {
        actor: "SYSTEM",
        action: "admin.login_failed",
        entityType: "AdminUser",
        entityId: user.id,
        after: { username },
        reason: "locked",
        at: now,
      });
      return { ok: false };
    }

    if (passwordOk) {
      await tx.adminUser.update({
        where: { id: user.id },
        data: { failedCount: 0, lockedUntil: null },
      });
      const session = await createSession(tx, user.id, now);
      await writeAudit(tx, {
        actor: "ADMIN",
        action: "admin.login",
        entityType: "AdminUser",
        entityId: user.id,
        after: { username },
        at: now,
      });
      return { ok: true, result: { ...session, userId: user.id } };
    }

    // An expired lock (lockedUntil <= now) starts a fresh count.
    const previous = row.lockedUntil !== null ? 0 : row.failedCount;
    const failedCount = previous + 1;
    const lockedUntil =
      failedCount >= MAX_FAILED_LOGINS ? new Date(now.getTime() + LOCKOUT_MS) : null;
    await tx.adminUser.update({ where: { id: user.id }, data: { failedCount, lockedUntil } });
    await writeAudit(tx, {
      actor: "SYSTEM",
      action: "admin.login_failed",
      entityType: "AdminUser",
      entityId: user.id,
      after: { username },
      reason: lockedUntil ? "wrong_password_locked" : "wrong_password",
      at: now,
    });
    return { ok: false };
  });

  if (!outcome.ok) throw invalidCredentials();
  return outcome.result;
}

// ---------------------------------------------------------------------------
// Password reset

export interface PasswordResetRequestInput {
  /** e.g. "https://bunbunnybakes.com"; the emailed link is SITE_URL + "/admin/reset?token=…". */
  siteUrl: string;
  now: Date;
}

export type PasswordResetRequestResult =
  | { status: "created"; resetId: string; notificationId: string | null }
  | { status: "rate_limited" }
  | { status: "no_admin" };

/**
 * Creates a reset token for the admin and enqueues its email, in one transaction.
 * At most 3 requests per hour (all requests count, whatever their outcome).
 * The route always answers the same, so the result is for tests and logs only.
 */
export async function requestPasswordReset(
  db: DbClient,
  input: PasswordResetRequestInput,
): Promise<PasswordResetRequestResult> {
  const { now } = input;
  const base = input.siteUrl.replace(/\/+$/, "");
  return db.$transaction(async (tx) => {
    // Serialize requests so the hourly limit is exact.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${RESET_RATE_LIMIT_KEY}))`;
    const since = new Date(now.getTime() - RESET_RATE_WINDOW_MS);
    const recent = await tx.rateLimitHit.count({
      where: { key: RESET_RATE_LIMIT_KEY, at: { gt: since } },
    });
    if (recent >= RESET_RATE_LIMIT) return { status: "rate_limited" as const };
    await tx.rateLimitHit.create({ data: { key: RESET_RATE_LIMIT_KEY, at: now } });

    // Single admin (SECURITY.md §3); the oldest one if there were ever more.
    const admin = await tx.adminUser.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!admin) return { status: "no_admin" as const };

    const token = newToken();
    const reset = await tx.passwordReset.create({
      data: {
        tokenHash: hashToken(token),
        userId: admin.id,
        createdAt: now,
        expiresAt: new Date(now.getTime() + RESET_TTL_MS),
      },
      select: { id: true },
    });
    const enqueued = await enqueueNotification(tx, {
      kind: "PASSWORD_RESET",
      dedupeKey: `password_reset:${reset.id}`,
      payload: { url: `${base}/admin/reset?token=${token}` },
      now,
    });
    return {
      status: "created" as const,
      resetId: reset.id,
      notificationId: enqueued.created ? enqueued.id : null,
    };
  });
}

export interface PasswordResetConfirmInput {
  token: string;
  newPassword: string;
  now: Date;
}

function invalidResetToken(): AppError {
  return new AppError("VALIDATION", {
    message: copy.admin.auth.resetInvalid,
    extra: { fields: { token: copy.admin.auth.resetInvalid } },
  });
}

/**
 * Sets a new password with a reset token: single use, unexpired. Deletes all sessions
 * of the user, clears the lockout and marks every outstanding reset of the user used.
 */
export async function confirmPasswordReset(
  db: DbClient,
  input: PasswordResetConfirmInput,
): Promise<void> {
  const { token, newPassword, now } = input;
  assertNewPassword(newPassword);
  if (!token || token.length > 128) throw invalidResetToken();
  const tokenHash = hashToken(token);
  const passwordHash = await hashPassword(newPassword); // slow: outside the transaction

  await db.$transaction(async (tx) => {
    const reset = await tx.passwordReset.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true },
    });
    if (!reset) throw invalidResetToken();
    // Conditional update = atomic single use.
    const claimed = await tx.passwordReset.updateMany({
      where: { id: reset.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) throw invalidResetToken();

    await tx.adminUser.update({
      where: { id: reset.userId },
      data: { passwordHash, failedCount: 0, lockedUntil: null },
    });
    // Other outstanding links of this user stop working too.
    await tx.passwordReset.updateMany({
      where: { userId: reset.userId, usedAt: null },
      data: { usedAt: now },
    });
    const sessions = await tx.adminSession.deleteMany({ where: { userId: reset.userId } });
    await writeAudit(tx, {
      actor: "ADMIN",
      action: "admin.password_reset",
      entityType: "AdminUser",
      entityId: reset.userId,
      after: { sessionsRevoked: sessions.count },
      at: now,
    });
  });
}

// ---------------------------------------------------------------------------
// Change password (settings page, later task)

export interface ChangePasswordInput {
  userId: string;
  currentPassword: string;
  newPassword: string;
  /** tokenHash of the session making the change; it stays logged in. */
  keepSessionTokenHash: string;
  now: Date;
}

export async function changePassword(db: DbClient, input: ChangePasswordInput): Promise<void> {
  const { userId, currentPassword, newPassword, keepSessionTokenHash, now } = input;
  const user = await db.adminUser.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  const ok = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), currentPassword);
  if (!user || !ok) {
    throw new AppError("VALIDATION", {
      message: copy.admin.auth.currentPasswordWrong,
      extra: { fields: { currentPassword: copy.admin.auth.currentPasswordWrong } },
    });
  }
  assertNewPassword(newPassword);
  const passwordHash = await hashPassword(newPassword);

  await db.$transaction(async (tx) => {
    await tx.adminUser.update({
      where: { id: userId },
      data: { passwordHash, failedCount: 0, lockedUntil: null },
    });
    const sessions = await tx.adminSession.deleteMany({
      where: { userId, tokenHash: { not: keepSessionTokenHash } },
    });
    await writeAudit(tx, {
      actor: "ADMIN",
      action: "admin.password_change",
      entityType: "AdminUser",
      entityId: userId,
      after: { sessionsRevoked: sessions.count },
      at: now,
    });
  });
}

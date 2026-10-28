// Admin side of the 消除大面包 game (L3): tier configuration, leaderboard moderation, weekly award.
//
// Raw SQL is used for the game tables so every comparison is lower()/text based (no ILIKE: wechat
// ids may contain _ and %). Ids are DB-generated uuids; GameTier.imageUrl is NULL when unset.
// The leaderboard and award functions take the game (D124: `?game=tu` = 兔了个兔, default the
// first game); tiers are shared (D123) and so is the ban list.

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { copy } from "@/copy";
import { isLocalDate, weekdayOf } from "@/domain/dates";
import { fieldFor } from "@/lib/fieldColor";
import { writeAudit } from "./audit";
import type { DbClient, Tx } from "./db";
import { AppError } from "./errors";
import type { GameKind } from "./game";
import { MAX_PRODUCT_TIERS } from "./gameTiers";
import { weekKeyOf } from "./gameWeek";
import { imageUrlForKey, keyFromImageUrl } from "./imageFormat";
import type { ImageStore } from "./imageStore";
import { readUploadedImage } from "./productImage";

const t = copy.admin.game;

export { MAX_PRODUCT_TIERS };
export const MIN_PRODUCT_TIERS = 2;
const DEFAULT_TIER_COUNT = MAX_PRODUCT_TIERS;
const BIG_SORT = 1000;

const notFound = () => new AppError("NOT_FOUND");
const invalid = (message: string, field = "value") =>
  new AppError("VALIDATION", { message, extra: { fields: { [field]: message } } });
const uuid = z.uuid();

export { weekKeyOf };

function lockTiers(tx: Tx) {
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('game-tiers'))`;
}

// ---- tiers --------------------------------------------------------------------------------

interface TierRow {
  id: string;
  productId: string | null;
  sortOrder: number;
  imageUrl: string | null;
  isBig: boolean;
  name: string | null;
  fieldColor: string | null;
}

export interface TierDto {
  id: string;
  productId: string | null;
  productName: string | null;
  isBig: boolean;
  /** No product behind it (D107): the tier carries its own name and colour. */
  gameOnly: boolean;
  /** The name the game shows (own name, else the product's); "" for a game-only piece that lost its name. */
  name: string;
  /** The tier's own colour override (`#RRGGBB`); null = the product's colour. */
  fieldColor: string | null;
  imageUrl: string | null;
  /** The product's cover photo (shown when the tier has no image of its own). */
  productImageUrl: string | null;
  color: { bg: string; ink: string };
}

export interface PickerProduct {
  id: string;
  name: string;
  imageUrl: string | null;
}

export interface TiersView {
  /** False while the owner has not saved any tier: runs use the default tiers. */
  configured: boolean;
  tiers: TierDto[];
  products: PickerProduct[];
}

const tierRows = (tx: Tx | DbClient): Promise<TierRow[]> =>
  tx.$queryRaw<TierRow[]>`
    SELECT "id"::text AS id, "productId"::text AS "productId", "sortOrder", NULLIF("imageUrl", '') AS "imageUrl", "isBig", "name", "fieldColor"
    FROM "GameTier" ORDER BY "isBig" ASC, "sortOrder" ASC, "createdAt" ASC`;

async function activeProducts(db: Tx | DbClient): Promise<PickerProduct[]> {
  const rows = await db.product.findMany({
    where: { status: "ACTIVE" },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, imageUrl: true },
  });
  return rows;
}

export async function getTiers(db: DbClient): Promise<TiersView> {
  const [rows, products, allNames] = await Promise.all([
    tierRows(db),
    activeProducts(db),
    db.product.findMany({ select: { id: true, name: true, imageUrl: true, fieldColor: true } }),
  ]);
  const byId = new Map(allNames.map((p) => [p.id, p]));
  const configured = rows.length > 0;
  const productTiers: TierDto[] = configured
    ? rows
        .filter((r) => !r.isBig)
        .map((r) => {
          const prod = r.productId ? byId.get(r.productId) : undefined;
          return {
            id: r.id,
            productId: r.productId,
            productName: prod?.name ?? null,
            isBig: false,
            gameOnly: !r.productId,
            name: r.name ?? prod?.name ?? "",
            fieldColor: r.fieldColor,
            imageUrl: r.imageUrl,
            productImageUrl: prod?.imageUrl ?? null,
            color: colorFor(r.fieldColor ?? prod?.fieldColor),
          };
        })
    : products.slice(0, DEFAULT_TIER_COUNT).map((p) => ({
        id: `default-${p.id}`,
        productId: p.id,
        productName: p.name,
        isBig: false,
        gameOnly: false,
        name: p.name,
        fieldColor: null,
        imageUrl: null,
        productImageUrl: p.imageUrl,
        color: colorFor(byId.get(p.id)?.fieldColor),
      }));
  const big = rows.find((r) => r.isBig);
  const tiers: TierDto[] = [
    ...productTiers,
    {
      id: big?.id ?? "big",
      productId: null,
      productName: null,
      isBig: true,
      gameOnly: false,
      name: copy.customer.brand.brandName,
      fieldColor: null,
      imageUrl: big?.imageUrl ?? null,
      productImageUrl: null,
      color: BIG_COLOR,
    },
  ];
  return { configured, tiers, products };
}

const BIG_COLOR = { bg: "#EFE7DA", ink: "#4A2723" }; // same as the game's big tier (gameTiers.ts)

/** The product's home colour (D95), as the game draws the tier. */
function colorFor(fieldColor: string | null | undefined): { bg: string; ink: string } {
  const f = fieldFor(fieldColor);
  return { bg: f.bg, ink: f.ink };
}

/** First write: store the defaults (active products in menu order, up to 8) plus the big tier. */
async function materialize(tx: Tx, now: Date): Promise<TierRow[]> {
  const existing = await tierRows(tx);
  if (existing.length > 0) return existing;
  const products = (await activeProducts(tx)).slice(0, DEFAULT_TIER_COUNT);
  const ts = now.toISOString();
  let i = 0;
  for (const p of products) {
    await tx.$executeRaw`
      INSERT INTO "GameTier" ("id","productId","sortOrder","imageUrl","isBig","createdAt","updatedAt")
      VALUES (gen_random_uuid(), ${p.id}::uuid, ${i++}, NULL, false, ${ts}::timestamptz, ${ts}::timestamptz)`;
  }
  await tx.$executeRaw`
    INSERT INTO "GameTier" ("id","productId","sortOrder","imageUrl","isBig","createdAt","updatedAt")
    VALUES (gen_random_uuid(), NULL, ${BIG_SORT}, NULL, true, ${ts}::timestamptz, ${ts}::timestamptz)`;
  return tierRows(tx);
}

const productTierCount = (rows: TierRow[]) => rows.filter((r) => !r.isBig).length;

async function assertActiveProduct(tx: Tx, productId: string) {
  if (!uuid.safeParse(productId).success) throw invalid(t.addPick, "productId");
  const p = await tx.product.findUnique({ where: { id: productId }, select: { status: true } });
  if (!p || p.status !== "ACTIVE") throw invalid(t.addPick, "productId");
}

async function writeTierAudit(tx: Tx, action: string, id: string, now: Date, before?: unknown, after?: unknown) {
  await writeAudit(tx, { actor: "ADMIN", action, entityType: "GameTier", entityId: id, before, after, at: now });
}

export async function addTier(db: DbClient, productId: string, now: Date): Promise<void> {
  await db.$transaction(async (tx) => {
    await lockTiers(tx);
    const rows = await materialize(tx, now);
    if (productTierCount(rows) >= MAX_PRODUCT_TIERS) throw invalid(t.maxTiers);
    await assertActiveProduct(tx, productId);
    if (rows.some((r) => !r.isBig && r.productId === productId)) throw invalid(t.dupProduct, "productId");
    const next = Math.max(-1, ...rows.filter((r) => !r.isBig).map((r) => r.sortOrder)) + 1;
    const ts = now.toISOString();
    const id = (
      await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO "GameTier" ("id","productId","sortOrder","imageUrl","isBig","createdAt","updatedAt")
        VALUES (gen_random_uuid(), ${productId}::uuid, ${next}, NULL, false, ${ts}::timestamptz, ${ts}::timestamptz)
        RETURNING "id"::text AS id`
    )[0].id;
    await writeTierAudit(tx, "game.tier.add", id, now, undefined, { productId });
  });
}

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/).transform((v) => v.toUpperCase());
// Trimmed, 1-12 characters (by Unicode code point), no control or bidi/format characters.
const pieceName = z
  .string()
  .trim()
  .refine((v) => [...v].length >= 1 && [...v].length <= 12 && !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(v));

export const gamePieceSchema = z.object({ name: pieceName, fieldColor: hex });
export const tierEditSchema = z.object({ name: pieceName.optional(), fieldColor: hex.nullable().optional() });

/** Adds a game-only piece (D107): a name and a colour, no product. */
export async function addGamePiece(db: DbClient, input: unknown, now: Date): Promise<void> {
  const parsed = gamePieceSchema.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0] === "fieldColor" ? "fieldColor" : "name";
    throw invalid(field === "name" ? t.pieceNameInvalid : t.pieceColorInvalid, field);
  }
  const { name, fieldColor } = parsed.data;
  await db.$transaction(async (tx) => {
    await lockTiers(tx);
    const rows = await materialize(tx, now);
    if (productTierCount(rows) >= MAX_PRODUCT_TIERS) throw invalid(t.maxTiers);
    const next = Math.max(-1, ...rows.filter((r) => !r.isBig).map((r) => r.sortOrder)) + 1;
    const ts = now.toISOString();
    const id = (
      await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO "GameTier" ("id","productId","sortOrder","imageUrl","name","fieldColor","isBig","createdAt","updatedAt")
        VALUES (gen_random_uuid(), NULL, ${next}, NULL, ${name}, ${fieldColor}, false, ${ts}::timestamptz, ${ts}::timestamptz)
        RETURNING "id"::text AS id`
    )[0].id;
    await writeTierAudit(tx, "game.tier.add", id, now, undefined, { name, fieldColor });
  });
}

/** Edits a non-big tier's name and/or colour. `fieldColor: null` resets to the product's colour. */
export async function updateTierLook(db: DbClient, id: string, input: unknown, now: Date): Promise<void> {
  if (!uuid.safeParse(id).success) throw notFound();
  const parsed = tierEditSchema.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0] === "fieldColor" ? "fieldColor" : "name";
    throw invalid(field === "name" ? t.pieceNameInvalid : t.pieceColorInvalid, field);
  }
  const { name, fieldColor } = parsed.data;
  if (name === undefined && fieldColor === undefined) throw invalid(t.loadFailed);
  await db.$transaction(async (tx) => {
    await lockTiers(tx);
    const rows = await materialize(tx, now);
    const row = rows.find((r) => r.id === id);
    if (!row || row.isBig) throw notFound();
    const nextName = name === undefined ? row.name : name;
    const nextColor = fieldColor === undefined ? row.fieldColor : fieldColor;
    // A game-only piece has no product colour to fall back to, so it cannot be reset (a name-only edit
    // of a piece left behind by a deleted product keeps its NULL colour and the preset cycle).
    if (!row.productId && fieldColor === null) throw invalid(t.pieceColorInvalid, "fieldColor");
    await tx.$executeRaw`UPDATE "GameTier" SET "name" = ${nextName}, "fieldColor" = ${nextColor}, "updatedAt" = ${now.toISOString()}::timestamptz WHERE "id"::text = ${id}`;
    await writeTierAudit(tx, "game.tier.update", id, now, { name: row.name, fieldColor: row.fieldColor }, { name: nextName, fieldColor: nextColor });
  });
}

export async function updateTierProduct(db: DbClient, id: string, productId: string, now: Date): Promise<void> {
  if (!uuid.safeParse(id).success) throw notFound();
  await db.$transaction(async (tx) => {
    await lockTiers(tx);
    const rows = await materialize(tx, now);
    const row = rows.find((r) => r.id === id);
    if (!row || row.isBig) throw notFound();
    await assertActiveProduct(tx, productId);
    if (rows.some((r) => !r.isBig && r.productId === productId && r.id !== id)) throw invalid(t.dupProduct, "productId");
    await tx.$executeRaw`UPDATE "GameTier" SET "productId" = ${productId}::uuid, "updatedAt" = ${now.toISOString()}::timestamptz WHERE "id"::text = ${id}`;
    await writeTierAudit(tx, "game.tier.update", id, now, { productId: row.productId }, { productId });
  });
}

/** Saves the default tiers so they can be edited (no-op when tiers already exist). */
export async function initTiers(db: DbClient, now: Date): Promise<void> {
  await db.$transaction(async (tx) => {
    await lockTiers(tx);
    await materialize(tx, now);
  });
}

export async function removeTier(db: DbClient, store: ImageStore, id: string, now: Date): Promise<void> {
  if (!uuid.safeParse(id).success) throw notFound();
  let oldUrl: string | null = null;
  await db.$transaction(async (tx) => {
    await lockTiers(tx);
    const rows = await tierRows(tx);
    const row = rows.find((r) => r.id === id);
    if (!row || row.isBig) throw notFound();
    if (productTierCount(rows) <= MIN_PRODUCT_TIERS) throw invalid(t.minTiers);
    oldUrl = row.imageUrl;
    await tx.$executeRaw`DELETE FROM "GameTier" WHERE "id"::text = ${id}`;
    await writeTierAudit(tx, "game.tier.remove", id, now, { productId: row.productId, imageUrl: row.imageUrl });
  });
  await bestEffortDelete(store, keyFromImageUrl(oldUrl));
}

export async function reorderTiers(db: DbClient, ids: string[], now: Date): Promise<void> {
  await db.$transaction(async (tx) => {
    await lockTiers(tx);
    const rows = await materialize(tx, now);
    const current = rows.filter((r) => !r.isBig).map((r) => r.id);
    const same = ids.length === current.length && new Set(ids).size === ids.length && ids.every((i) => current.includes(i));
    if (!same) throw invalid(t.loadFailed, "ids");
    for (let i = 0; i < ids.length; i++) {
      await tx.$executeRaw`UPDATE "GameTier" SET "sortOrder" = ${i}, "updatedAt" = ${now.toISOString()}::timestamptz WHERE "id"::text = ${ids[i]}`;
    }
    await writeTierAudit(tx, "game.tier.order", "tiers", now, current, ids);
  });
}

async function bestEffortDelete(store: ImageStore, key: string | null) {
  if (!key) return;
  try {
    await store.delete(key);
  } catch {
    // an orphaned blob is harmless
  }
}

async function changeTierImage(
  db: DbClient,
  store: ImageStore,
  id: string,
  newKey: string | null,
  now: Date,
): Promise<void> {
  let oldUrl: string | null = null;
  try {
    await db.$transaction(async (tx) => {
      await lockTiers(tx);
      const rows = await materialize(tx, now);
      // The default view shows a synthetic "big" id until the first save; map it to the real row.
      const row = id === "big" ? rows.find((r) => r.isBig) : rows.find((r) => r.id === id);
      if (!row) throw notFound();
      oldUrl = row.imageUrl;
      const url = newKey ? imageUrlForKey(newKey) : null;
      await tx.$executeRaw`UPDATE "GameTier" SET "imageUrl" = ${url}, "updatedAt" = ${now.toISOString()}::timestamptz WHERE "id"::text = ${row.id}`;
      await writeTierAudit(tx, "game.tier.image", row.id, now, { imageUrl: row.imageUrl }, { imageUrl: url });
    });
  } catch (e) {
    await bestEffortDelete(store, newKey);
    throw e;
  }
  await bestEffortDelete(store, keyFromImageUrl(oldUrl));
}

export async function uploadTierImage(db: DbClient, store: ImageStore, id: string, request: Request, now: Date) {
  if (id !== "big" && !uuid.safeParse(id).success) throw notFound();
  const { bytes, kind } = await readUploadedImage(request);
  const key = `game/${randomBytes(16).toString("hex")}.${kind.ext}`;
  await store.put(key, bytes, kind.contentType);
  await changeTierImage(db, store, id, key, now);
}

export async function deleteTierImage(db: DbClient, store: ImageStore, id: string, now: Date) {
  if (id !== "big" && !uuid.safeParse(id).success) throw notFound();
  await changeTierImage(db, store, id, null, now);
}

// ---- leaderboard --------------------------------------------------------------------------

export interface RunRowDto {
  id: string;
  /** Full WeChat id (admin only). */
  wechatId: string;
  nickname: string;
  score: number;
  finishedAt: string;
  verified: boolean;
  hidden: boolean;
  banned: boolean;
  /** Has a non-cancelled, non-rejected order (the prize eligibility, D104). */
  ordered: boolean;
  /** Evidence for the manual check before paying: number of drops (兔了个兔: taps) and the played length. */
  dropCount: number | null;
  durationSec: number | null;
  /**
   * 兔了个兔 owner flag for the manual check before awarding (D103): the run reached MAX_TAPS or its
   * median gap between taps is under 300 ms. The run still counts on the board. Always false for
   * the first game.
   */
  suspicious: boolean;
  /** Rank among the runs that count (best per WeChat id, not hidden, not banned); null otherwise. */
  rank: number | null;
}

export interface AwardDto {
  weekKey: string;
  runId: string;
  contactedAt: string | null;
  redeemedAt: string | null;
  note: string;
  wechatId: string;
  nickname: string;
  score: number;
  ordered: boolean;
}

export interface BanDto {
  wechatId: string;
  reason: string | null;
  createdAt: string;
}

export interface BoardView {
  week: string;
  currentWeek: string;
  weeks: string[];
  rows: RunRowDto[];
  /** The stored award, or the current leader (stored = false) for a week that has no award row yet. */
  winner: (AwardDto & { stored: boolean }) | null;
  bans: BanDto[];
}

interface RawRun {
  id: string;
  wechatId: string;
  nickname: string;
  score: number | null;
  finishedAt: Date | null;
  hidden: boolean;
  dropCount: number | null;
  simSteps: number | null;
  playMs: number | null;
  suspicious: boolean;
}

const lc = (s: string) => s.toLowerCase();

/** 消除大面包: simulated steps of 1/120 s; 兔了个兔: the last tap's client time. */
function durationSecOf(game: GameKind, r: RawRun): number | null {
  if (game === "TU") return r.playMs === null ? null : Math.round(r.playMs / 1000);
  return r.simSteps === null ? null : Math.round(r.simSteps / 120);
}

/** Which of these WeChat ids have ordered (L1's hasOrdered: not CANCELLED / REJECTED, case-insensitive). */
export async function orderedSet(db: DbClient, wechatIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(wechatIds.map((w) => lc(w.trim())))];
  if (ids.length === 0) return new Set();
  // One query, same rule as hasOrdered; equality on lower() only (no LIKE/ILIKE patterns).
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT lower("wechatId") AS id FROM "Order"
    WHERE lower("wechatId") = ANY(${ids}::text[]) AND status::text NOT IN ('CANCELLED', 'REJECTED')`;
  return new Set(rows.map((r) => r.id));
}

export const weekQuerySchema = z
  .string()
  .refine((v) => isLocalDate(v) && weekdayOf(v) === 1, { message: "Invalid week" });

/** `?game=` of the admin game endpoints: `tu` = 兔了个兔, `big` or absent = 消除大面包. */
export const gameQuerySchema = z
  .enum(["big", "tu"])
  .optional()
  .transform((g): GameKind => (g === "tu" ? "TU" : "BIG"));

/** The game of an admin request's `?game=` (VALIDATION for anything but big / tu). */
export function gameOfRequest(request: Request): GameKind {
  const r = gameQuerySchema.safeParse(new URL(request.url).searchParams.get("game") ?? undefined);
  if (!r.success) throw invalid(copy.errors.VALIDATION, "game");
  return r.data;
}

const RUN_COLUMNS = Prisma.sql`"id"::text AS id, "wechatId", "nickname", "score", "finishedAt", "hidden", "dropCount", "simSteps", "playMs", "suspicious"`;

export async function getBoard(
  db: DbClient,
  week: string | undefined,
  now: Date,
  game: GameKind = "BIG",
): Promise<BoardView> {
  const currentWeek = weekKeyOf(now);
  const wk = week ?? currentWeek;
  const g = Prisma.sql`${game}::"GameKind"`;
  const [runs, weekRows, bans, awardRows] = await Promise.all([
    db.$queryRaw<RawRun[]>`
      SELECT ${RUN_COLUMNS}
      FROM "GameRun"
      WHERE "game" = ${g} AND "weekKey" = ${wk} AND "finishedAt" IS NOT NULL AND "score" IS NOT NULL
      ORDER BY "score" DESC, "finishedAt" ASC, "id" ASC LIMIT 300`,
    db.$queryRaw<{ weekKey: string }[]>`
      SELECT DISTINCT "weekKey" FROM "GameRun" WHERE "game" = ${g} AND "weekKey" IS NOT NULL ORDER BY "weekKey" DESC LIMIT 26`,
    db.$queryRaw<{ wechatId: string; reason: string | null; createdAt: Date }[]>`
      SELECT "wechatId", "reason", "createdAt" FROM "GameBan" ORDER BY "createdAt" DESC`,
    db.$queryRaw<
      { weekKey: string; runId: string; contactedAt: Date | null; redeemedAt: Date | null; note: string | null }[]
    >`SELECT "weekKey", "runId"::text AS "runId", "contactedAt", "redeemedAt", "note" FROM "GameAward" WHERE "game" = ${g} AND "weekKey" = ${wk}`,
  ]);
  const banned = new Set(bans.map((b) => lc(b.wechatId)));
  const award = awardRows[0] ?? null;
  const awardRun = award
    ? ((
        await db.$queryRaw<RawRun[]>`
          SELECT ${RUN_COLUMNS}
          FROM "GameRun" WHERE "id"::text = ${award.runId}`
      )[0] ?? null)
    : null;
  const ordered = await orderedSet(db, [...runs.map((r) => r.wechatId), ...(awardRun ? [awardRun.wechatId] : [])]);

  const seen = new Set<string>();
  let rank = 0;
  const rows: RunRowDto[] = runs.map((r) => {
    const key = lc(r.wechatId);
    const isBanned = banned.has(key);
    let rk: number | null = null;
    if (!r.hidden && !isBanned && !seen.has(key)) {
      seen.add(key);
      rk = ++rank;
    }
    return {
      id: r.id,
      wechatId: r.wechatId,
      nickname: r.nickname,
      score: r.score ?? 0,
      finishedAt: (r.finishedAt as Date).toISOString(),
      verified: true,
      hidden: r.hidden,
      banned: isBanned,
      ordered: ordered.has(key),
      dropCount: r.dropCount,
      durationSec: durationSecOf(game, r),
      suspicious: r.suspicious,
      rank: rk,
    };
  });

  let winner: BoardView["winner"] = null;
  if (award && awardRun) {
    winner = {
      weekKey: wk,
      runId: award.runId,
      contactedAt: award.contactedAt?.toISOString() ?? null,
      redeemedAt: award.redeemedAt?.toISOString() ?? null,
      note: award.note ?? "",
      wechatId: awardRun.wechatId,
      nickname: awardRun.nickname,
      score: awardRun.score ?? 0,
      ordered: ordered.has(lc(awardRun.wechatId)),
      stored: true,
    };
  } else {
    const lead = rows.find((r) => r.rank === 1);
    if (lead) {
      winner = {
        weekKey: wk,
        runId: lead.id,
        contactedAt: null,
        redeemedAt: null,
        note: "",
        wechatId: lead.wechatId,
        nickname: lead.nickname,
        score: lead.score,
        ordered: lead.ordered,
        stored: false,
      };
    }
  }

  const weeks = [...new Set([currentWeek, ...weekRows.map((w) => w.weekKey)])].sort().reverse();
  if (!weeks.includes(wk)) weeks.push(wk);
  return {
    week: wk,
    currentWeek,
    weeks,
    rows,
    winner,
    bans: bans.map((b) => ({ wechatId: b.wechatId, reason: b.reason, createdAt: b.createdAt.toISOString() })),
  };
}

// ---- moderation ---------------------------------------------------------------------------

/** Hides / shows a run of `game` (a run of the other game is NOT_FOUND). */
export async function setRunHidden(db: DbClient, id: string, hidden: boolean, now: Date, game: GameKind = "BIG"): Promise<void> {
  if (!uuid.safeParse(id).success) throw notFound();
  await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ hidden: boolean; wechatId: string; score: number | null; game: GameKind }[]>`
      SELECT "hidden", "wechatId", "score", "game"::text AS game FROM "GameRun" WHERE "id"::text = ${id} FOR UPDATE`;
    if (rows.length === 0 || rows[0].game !== game) throw notFound();
    if (rows[0].hidden === hidden) return;
    await tx.$executeRaw`UPDATE "GameRun" SET "hidden" = ${hidden} WHERE "id"::text = ${id}`;
    await writeAudit(tx, {
      actor: "ADMIN",
      action: hidden ? "game.run.hide" : "game.run.unhide",
      entityType: "GameRun",
      entityId: id,
      before: { hidden: !hidden },
      after: { hidden, wechatId: rows[0].wechatId, score: rows[0].score },
      at: now,
    });
  });
}

export const banBodySchema = z.object({
  wechatId: z.string().trim().min(1).max(64),
  reason: z.string().trim().max(200).optional(),
});

export async function banWechat(db: DbClient, input: z.output<typeof banBodySchema>, now: Date): Promise<void> {
  await db.$transaction(async (tx) => {
    const prior = await tx.$queryRaw<{ reason: string | null }[]>`
      SELECT "reason" FROM "GameBan" WHERE lower("wechatId") = lower(${input.wechatId})`;
    const inserted = await tx.$executeRaw`
      INSERT INTO "GameBan" ("wechatId","reason","createdAt")
      SELECT ${input.wechatId}, ${input.reason || null}, ${now.toISOString()}::timestamptz
      WHERE NOT EXISTS (SELECT 1 FROM "GameBan" WHERE lower("wechatId") = lower(${input.wechatId}))`;
    if (inserted === 0) {
      await tx.$executeRaw`UPDATE "GameBan" SET "reason" = ${input.reason || null} WHERE lower("wechatId") = lower(${input.wechatId})`;
    }
    await writeAudit(tx, {
      actor: "ADMIN",
      action: "game.ban",
      entityType: "GameBan",
      entityId: input.wechatId,
      before: prior[0] ? { wechatId: input.wechatId, reason: prior[0].reason } : undefined,
      after: { wechatId: input.wechatId },
      reason: input.reason || null,
      at: now,
    });
  });
}

export async function unbanWechat(db: DbClient, wechatId: string, now: Date): Promise<void> {
  const id = wechatId.trim();
  if (!id || id.length > 64) throw notFound();
  await db.$transaction(async (tx) => {
    const n = await tx.$executeRaw`DELETE FROM "GameBan" WHERE lower("wechatId") = lower(${id})`;
    if (n === 0) throw notFound();
    await writeAudit(tx, {
      actor: "ADMIN",
      action: "game.unban",
      entityType: "GameBan",
      entityId: id,
      before: { wechatId: id },
      at: now,
    });
  });
}

export const awardBodySchema = z.object({
  week: weekQuerySchema,
  contacted: z.boolean().optional(),
  redeemed: z.boolean().optional(),
  note: z.string().trim().max(500).optional(),
});

/** Records 已联系 / 已兑奖 / note for a week; the row is created on first use for the week's current leader. */
export async function updateAward(
  db: DbClient,
  input: z.output<typeof awardBodySchema>,
  now: Date,
  game: GameKind = "BIG",
): Promise<void> {
  const board = await getBoard(db, input.week, now, game);
  const g = Prisma.sql`${game}::"GameKind"`;
  // The first game keeps its original lock key.
  const lockKey = game === "BIG" ? `game-award:${input.week}` : `game-award:${game}:${input.week}`;
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    const ts = now.toISOString();
    const existing = await tx.$queryRaw<{ contactedAt: Date | null; redeemedAt: Date | null; note: string | null }[]>`
      SELECT "contactedAt", "redeemedAt", "note" FROM "GameAward" WHERE "game" = ${g} AND "weekKey" = ${input.week}`;
    if (existing.length === 0) {
      const lead = board.rows.find((r) => r.rank === 1);
      if (!lead) throw invalid(t.winnerNone, "week");
      await tx.$executeRaw`
        INSERT INTO "GameAward" ("game","weekKey","runId") VALUES (${g}, ${input.week}, ${lead.id}::uuid)`;
    }
    const before = existing[0]
      ? { contacted: !!existing[0].contactedAt, redeemed: !!existing[0].redeemedAt, note: existing[0].note }
      : null;
    if (input.contacted !== undefined) {
      await tx.$executeRaw`UPDATE "GameAward" SET "contactedAt" = ${input.contacted ? ts : null}::timestamptz WHERE "game" = ${g} AND "weekKey" = ${input.week}`;
    }
    if (input.redeemed !== undefined) {
      await tx.$executeRaw`UPDATE "GameAward" SET "redeemedAt" = ${input.redeemed ? ts : null}::timestamptz WHERE "game" = ${g} AND "weekKey" = ${input.week}`;
    }
    if (input.note !== undefined) {
      await tx.$executeRaw`UPDATE "GameAward" SET "note" = ${input.note || null} WHERE "game" = ${g} AND "weekKey" = ${input.week}`;
    }
    await writeAudit(tx, {
      actor: "ADMIN",
      action: "game.award",
      entityType: "GameAward",
      // The first game's audit rows keep their original entity id (the week).
      entityId: game === "BIG" ? input.week : `${game}:${input.week}`,
      before,
      after: { ...(game === "BIG" ? {} : { game }), contacted: input.contacted, redeemed: input.redeemed, note: input.note },
      at: now,
    });
  });
}

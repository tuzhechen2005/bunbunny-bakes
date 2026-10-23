// POST/DELETE /api/admin/products/{id}/image and GET /api/images/{key}. Real Postgres,
// in-memory image store (NETLIFY is not set): nothing here reaches Netlify.

import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let cookieToken: string | undefined;
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "bb_session" && cookieToken !== undefined ? { name, value: cookieToken } : undefined,
  }),
}));

import { DELETE, POST } from "@/app/api/admin/products/[id]/image/route";
import { GET as GET_IMAGE } from "@/app/api/images/[...key]/route";
import { createSession, hashPassword } from "@/server/auth";
import { prisma } from "@/server/db";
import { getImageStore } from "@/server/imageStore";
import { createDefaultProducts, createSettings, db, resetDb, type DefaultProductIds } from "./helpers";

const SITE = "https://bunbunnybakes.shop";
const UNKNOWN_ID = "11111111-1111-4111-8111-111111111111";
let previousSiteUrl: string | undefined;
let P: DefaultProductIds;
let validToken: string;

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/${name}`));
const storedKeys = () => (getImageStore() as unknown as { keys(): string[] }).keys();

beforeAll(() => {
  previousSiteUrl = process.env.SITE_URL;
  process.env.SITE_URL = SITE;
});

beforeEach(async () => {
  await resetDb();
  await createSettings({ orderingEnabled: true });
  P = await createDefaultProducts();
  const user = await db.adminUser.create({
    data: { username: "owner", passwordHash: await hashPassword("correct-horse-battery") },
  });
  validToken = (await createSession(db, user.id, new Date())).token;
  cookieToken = validToken;
  for (const key of storedKeys()) await getImageStore().delete(key);
});

afterAll(async () => {
  if (previousSiteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = previousSiteUrl;
  await db.$disconnect();
  await prisma.$disconnect();
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const keyCtx = (key: string) => ({ params: Promise.resolve({ key: key.split("/") }) });

function upload(
  id: string,
  bytes: Uint8Array | string,
  opts: { name?: string; type?: string; headers?: Record<string, string>; field?: string } = {},
) {
  const form = new FormData();
  form.append(
    opts.field ?? "file",
    new File([bytes as BlobPart], opts.name ?? "p.jpg", { type: opts.type ?? "image/jpeg" }),
  );
  return POST(
    new Request(`${SITE}/api/admin/products/${id}/image`, {
      method: "POST",
      headers: opts.headers ?? { origin: SITE },
      body: form,
    }),
    ctx(id),
  );
}

const del = (id: string, headers: Record<string, string> = { origin: SITE }) =>
  DELETE(new Request(`${SITE}/api/admin/products/${id}/image`, { method: "DELETE", headers }), ctx(id));

const keyOf = (url: string) => url.replace("/api/images/", "");

describe("auth", () => {
  it("401 without a session", async () => {
    cookieToken = undefined;
    expect((await upload(P.redBean, fixture("bun.jpg"))).status).toBe(401);
    expect((await del(P.redBean)).status).toBe(401);
    expect(storedKeys()).toEqual([]);
  });

  it("403 with a foreign or missing Origin, before touching data", async () => {
    for (const headers of [{} as Record<string, string>, { origin: "https://evil.example" }]) {
      expect((await upload(P.redBean, fixture("bun.jpg"), { headers })).status).toBe(403);
      expect((await del(P.redBean, headers)).status).toBe(403);
    }
    expect((await db.product.findUniqueOrThrow({ where: { id: P.redBean } })).imageUrl).toBeNull();
    expect(await db.auditLog.count()).toBe(0);
    expect(storedKeys()).toEqual([]);
  });
});

describe("upload", () => {
  it.each([
    ["bun.jpg", "image/jpeg", "jpg"],
    ["bun.png", "image/png", "png"],
    ["bun.webp", "image/webp", "webp"],
  ])("accepts %s, stores it and sets imageUrl + audit", async (file, type, ext) => {
    const res = await upload(P.redBean, fixture(file), { name: "whatever.bin", type: "application/octet-stream" });
    expect(res.status).toBe(200);
    const { product } = await res.json();
    expect(product.imageUrl).toMatch(new RegExp(`^/api/images/${P.redBean}/[0-9a-f]{32}\\.${ext}$`));
    const stored = await getImageStore().get(keyOf(product.imageUrl));
    expect(stored?.contentType).toBe(type);
    expect(Buffer.from(stored!.data).equals(Buffer.from(fixture(file)))).toBe(true);

    expect((await db.product.findUniqueOrThrow({ where: { id: P.redBean } })).imageUrl).toBe(product.imageUrl);
    const audit = await db.auditLog.findMany({ where: { entityId: P.redBean } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor: "ADMIN",
      action: "product.update",
      entityType: "Product",
      before: { imageUrl: null },
      after: { imageUrl: product.imageUrl },
    });
  });

  it("rejects HTML or PDF bytes even with a .png name and image/png type", async () => {
    for (const body of ["<html><script>alert(1)</script></html>", "%PDF-1.7 fake"]) {
      const res = await upload(P.redBean, body, { name: "cute.png", type: "image/png" });
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error).toBe("VALIDATION");
      expect(json.message).toMatch(/JPG|PNG|WebP/);
    }
    expect((await db.product.findUniqueOrThrow({ where: { id: P.redBean } })).imageUrl).toBeNull();
    expect(await db.auditLog.count()).toBe(0);
    expect(storedKeys()).toEqual([]);
  });

  it("rejects files over 5 MB (and empty or missing files); exactly 5 MB is fine", async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set([0xff, 0xd8, 0xff]);
    const res = await upload(P.redBean, big);
    expect(res.status).toBe(422);
    expect((await res.json()).message).toContain("5 MB");
    expect((await upload(P.redBean, new Uint8Array())).status).toBe(422);
    expect((await upload(P.redBean, fixture("bun.jpg"), { field: "other" })).status).toBe(422);
    expect(storedKeys()).toEqual([]);
    const ok = new Uint8Array(5 * 1024 * 1024);
    ok.set([0xff, 0xd8, 0xff]);
    expect((await upload(P.redBean, ok)).status).toBe(200);
  });

  it("404 for an unknown product and writes no blob", async () => {
    expect((await upload(UNKNOWN_ID, fixture("bun.jpg"))).status).toBe(404);
    expect((await upload("not-a-uuid", fixture("bun.jpg"))).status).toBe(404);
    expect(storedKeys()).toEqual([]);
  });

  it("replacing a photo deletes the previous blob", async () => {
    const first = (await (await upload(P.redBean, fixture("bun.jpg"))).json()).product.imageUrl as string;
    const second = (await (await upload(P.redBean, fixture("bun.png"))).json()).product.imageUrl as string;
    expect(second).not.toBe(first);
    expect(await getImageStore().get(keyOf(first))).toBeNull();
    expect(await getImageStore().get(keyOf(second))).not.toBeNull();
    expect(storedKeys()).toEqual([keyOf(second)]);
    expect(await db.auditLog.count({ where: { entityId: P.redBean } })).toBe(2);
  });
});

describe("delete", () => {
  it("clears imageUrl, deletes the blob and audits", async () => {
    const url = (await (await upload(P.redBean, fixture("bun.webp"))).json()).product.imageUrl as string;
    const res = await del(P.redBean);
    expect(res.status).toBe(200);
    expect((await res.json()).product.imageUrl).toBeNull();
    expect(await getImageStore().get(keyOf(url))).toBeNull();
    const last = (await db.auditLog.findMany({ where: { entityId: P.redBean }, orderBy: { at: "desc" } }))[0];
    expect(last).toMatchObject({ action: "product.update", before: { imageUrl: url }, after: { imageUrl: null } });
    expect((await del(UNKNOWN_ID)).status).toBe(404);
  });
});

describe("GET /api/images/{key}", () => {
  it("returns the bytes with content type and immutable cache headers, without a session", async () => {
    const url = (await (await upload(P.redBean, fixture("bun.png"))).json()).product.imageUrl as string;
    cookieToken = undefined;
    const res = await GET_IMAGE(new Request(SITE + url), keyCtx(keyOf(url)));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(fixture("bun.png")))).toBe(true);
  });

  it("404s unknown and malformed keys, including path traversal", async () => {
    const url = (await (await upload(P.redBean, fixture("bun.jpg"))).json()).product.imageUrl as string;
    const key = keyOf(url);
    const [id, file] = key.split("/");
    for (const bad of [
      `${id}/${"0".repeat(32)}.jpg`, // well-formed but unknown
      `${id}/${file.replace(".jpg", ".gif")}`,
      `../${key}`,
      `${id}/../${id}/${file}`,
      `${id}/${file}/more`,
      "..",
      "x",
    ]) {
      const res = await GET_IMAGE(new Request(SITE + "/api/images/" + bad), keyCtx(bad));
      expect(res.status, bad).toBe(404);
      expect(res.headers.get("cache-control") ?? "").not.toContain("immutable");
    }
  });
});

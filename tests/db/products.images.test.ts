// /api/admin/products/{id}/images (+ /order, /{imageId}) and the product colour field (D95, D98).
// Real Postgres, in-memory image store.

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

import { DELETE as DELETE_ONE } from "@/app/api/admin/products/[id]/images/[imageId]/route";
import { PUT as PUT_ORDER } from "@/app/api/admin/products/[id]/images/order/route";
import { POST } from "@/app/api/admin/products/[id]/images/route";
import { PATCH } from "@/app/api/admin/products/[id]/route";
import { GET as LIST, POST as CREATE } from "@/app/api/admin/products/route";
import { createSession, hashPassword } from "@/server/auth";
import { prisma } from "@/server/db";
import { getImageStore } from "@/server/imageStore";
import { createDefaultProducts, createSettings, db, resetDb, type DefaultProductIds } from "./helpers";

const SITE = "https://bunbunnybakes.shop";
const UNKNOWN_ID = "11111111-1111-4111-8111-111111111111";
let previousSiteUrl: string | undefined;
let P: DefaultProductIds;

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/${name}`));
const storedKeys = () => (getImageStore() as unknown as { keys(): string[] }).keys();
const ctx = (id: string, imageId = "") => ({ params: Promise.resolve({ id, imageId }) });
const keyOf = (url: string) => url.replace("/api/images/", "");

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
  cookieToken = (await createSession(db, user.id, new Date())).token;
  for (const key of storedKeys()) await getImageStore().delete(key);
});

afterAll(async () => {
  if (previousSiteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = previousSiteUrl;
  await db.$disconnect();
  await prisma.$disconnect();
});

function add(id: string, file = "bun.jpg", headers: Record<string, string> = { origin: SITE }) {
  const form = new FormData();
  form.append("file", new File([fixture(file) as BlobPart], "p.jpg", { type: "image/jpeg" }));
  return POST(
    new Request(`${SITE}/api/admin/products/${id}/images`, { method: "POST", headers, body: form }),
    ctx(id),
  );
}

const order = (id: string, ids: unknown, headers: Record<string, string> = { origin: SITE }) =>
  PUT_ORDER(
    new Request(`${SITE}/api/admin/products/${id}/images/order`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ ids }),
    }),
    ctx(id),
  );

const remove = (id: string, imageId: string, headers: Record<string, string> = { origin: SITE }) =>
  DELETE_ONE(
    new Request(`${SITE}/api/admin/products/${id}/images/${imageId}`, { method: "DELETE", headers }),
    ctx(id, imageId),
  );

type Img = { id: string; url: string; sortOrder: number };
async function addMany(id: string, n: number): Promise<Img[]> {
  let last: Img[] = [];
  for (let i = 0; i < n; i++) {
    const res = await add(id);
    expect(res.status).toBe(201);
    last = (await res.json()).product.images;
  }
  return last;
}
const coverOf = async (id: string) => (await db.product.findUniqueOrThrow({ where: { id } })).imageUrl;

describe("auth and origin", () => {
  it("401 without a session, 403 with a foreign or missing Origin, nothing written", async () => {
    const [first] = await addMany(P.redBean, 1);
    const before = await db.auditLog.count();
    const restore = cookieToken;
    cookieToken = undefined;
    expect((await add(P.redBean)).status).toBe(401);
    expect((await order(P.redBean, [first.id])).status).toBe(401);
    expect((await remove(P.redBean, first.id)).status).toBe(401);
    cookieToken = "not-a-session-token";
    expect((await add(P.redBean)).status).toBe(401);
    cookieToken = restore;
    for (const headers of [{} as Record<string, string>, { origin: "https://evil.example" }]) {
      expect((await add(P.redBean, "bun.jpg", headers)).status).toBe(403);
      expect((await order(P.redBean, [first.id], headers)).status).toBe(403);
      expect((await remove(P.redBean, first.id, headers)).status).toBe(403);
    }
    expect(await db.productImage.count()).toBe(1);
    expect(await db.auditLog.count()).toBe(before);
    expect(storedKeys()).toHaveLength(1);
  });
});

describe("append", () => {
  it("appends in order, the first is the cover and Product.imageUrl mirrors it, with one audit row each", async () => {
    const one = await addMany(P.redBean, 1);
    expect(one).toHaveLength(1);
    expect(one[0].sortOrder).toBe(0);
    expect(one[0].url).toMatch(new RegExp(`^/api/images/${P.redBean}/[0-9a-f]{32}\\.jpg$`));
    expect(await coverOf(P.redBean)).toBe(one[0].url);

    const three = await addMany(P.redBean, 2);
    expect(three.map((i) => i.sortOrder)).toEqual([0, 1, 2]);
    expect(three[0].url).toBe(one[0].url);
    expect(await coverOf(P.redBean)).toBe(one[0].url);
    expect(storedKeys()).toHaveLength(3);

    const audit = await db.auditLog.findMany({ where: { entityId: P.redBean }, orderBy: { at: "asc" } });
    expect(audit).toHaveLength(3);
    expect(audit[0]).toMatchObject({ actor: "ADMIN", action: "product.update", before: { imageUrl: null, images: [] } });
    expect(audit[2]).toMatchObject({
      before: { imageUrl: one[0].url, images: three.slice(0, 2).map((i) => i.url) },
      after: { imageUrl: one[0].url, images: three.map((i) => i.url) },
    });
  });

  it("refuses a 7th photo with a Chinese VALIDATION message and stores no blob", async () => {
    await addMany(P.redBean, 6);
    const res = await add(P.redBean);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("VALIDATION");
    expect(json.message).toContain("6");
    expect(await db.productImage.count({ where: { productId: P.redBean } })).toBe(6);
    expect(storedKeys()).toHaveLength(6);
  });

  it("two concurrent uploads at 5 photos never exceed 6, and the loser's blob is removed", async () => {
    await addMany(P.redBean, 5);
    const results = await Promise.all([add(P.redBean), add(P.redBean)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    const rows = await db.productImage.findMany({ where: { productId: P.redBean }, orderBy: { sortOrder: "asc" } });
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(storedKeys()).toHaveLength(6);
  });

  it("rejects a bad file and an unknown product", async () => {
    const form = new FormData();
    form.append("file", new File(["<html></html>"], "x.png", { type: "image/png" }));
    const bad = await POST(
      new Request(`${SITE}/api/admin/products/${P.redBean}/images`, { method: "POST", headers: { origin: SITE }, body: form }),
      ctx(P.redBean),
    );
    expect(bad.status).toBe(422);
    expect((await add(UNKNOWN_ID)).status).toBe(404);
    expect((await add("not-a-uuid")).status).toBe(404);
    expect(await db.productImage.count()).toBe(0);
    expect(storedKeys()).toEqual([]);
  });

  it("keeps photos of different products apart", async () => {
    await addMany(P.redBean, 2);
    await addMany(P.brulee, 1);
    expect(await db.productImage.count({ where: { productId: P.redBean } })).toBe(2);
    expect(await db.productImage.count({ where: { productId: P.brulee } })).toBe(1);
  });
});

describe("order", () => {
  it("reorders, renumbers 0..n-1, moves the cover and audits", async () => {
    const imgs = await addMany(P.redBean, 3);
    const ids = [imgs[2].id, imgs[0].id, imgs[1].id];
    const res = await order(P.redBean, ids);
    expect(res.status).toBe(200);
    const { product } = await res.json();
    expect(product.images.map((i: Img) => i.id)).toEqual(ids);
    expect(product.images.map((i: Img) => i.sortOrder)).toEqual([0, 1, 2]);
    expect(product.imageUrl).toBe(imgs[2].url);
    expect(await coverOf(P.redBean)).toBe(imgs[2].url);
    const last = (await db.auditLog.findMany({ where: { entityId: P.redBean }, orderBy: { at: "desc" } }))[0];
    expect(last).toMatchObject({
      before: { imageUrl: imgs[0].url, images: imgs.map((i) => i.url) },
      after: { imageUrl: imgs[2].url, images: ids.map((id) => imgs.find((i) => i.id === id)!.url) },
    });
  });

  it("an unchanged order writes nothing", async () => {
    const imgs = await addMany(P.redBean, 2);
    const count = await db.auditLog.count();
    expect((await order(P.redBean, imgs.map((i) => i.id))).status).toBe(200);
    expect(await db.auditLog.count()).toBe(count);
  });

  it("409 STALE when the ids are not exactly the product's photos; 422 for malformed bodies", async () => {
    const imgs = await addMany(P.redBean, 2);
    const other = await addMany(P.brulee, 1);
    for (const ids of [[imgs[0].id], [imgs[0].id, other[0].id], [imgs[0].id, imgs[1].id, UNKNOWN_ID]]) {
      const res = await order(P.redBean, ids);
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("STALE");
    }
    expect((await order(P.redBean, [imgs[0].id, imgs[0].id])).status).toBe(422);
    expect((await order(P.redBean, [])).status).toBe(422);
    expect((await order(P.redBean, ["x"])).status).toBe(422);
    expect((await order(P.redBean, new Array(7).fill(imgs[0].id))).status).toBe(422);
    expect((await order(UNKNOWN_ID, [imgs[0].id])).status).toBe(404);
    expect((await db.productImage.findMany({ where: { productId: P.redBean }, orderBy: { sortOrder: "asc" } })).map((r) => r.id)).toEqual(
      imgs.map((i) => i.id),
    );
  });
});

describe("delete one", () => {
  it("removes the row and the blob, renumbers, and promotes the next photo when the cover goes", async () => {
    const imgs = await addMany(P.redBean, 3);
    const res = await remove(P.redBean, imgs[0].id);
    expect(res.status).toBe(200);
    const { product } = await res.json();
    expect(product.images.map((i: Img) => i.id)).toEqual([imgs[1].id, imgs[2].id]);
    expect(product.images.map((i: Img) => i.sortOrder)).toEqual([0, 1]);
    expect(product.imageUrl).toBe(imgs[1].url);
    expect(await coverOf(P.redBean)).toBe(imgs[1].url);
    expect(await getImageStore().get(keyOf(imgs[0].url))).toBeNull();
    expect(storedKeys()).toHaveLength(2);
    const last = (await db.auditLog.findMany({ where: { entityId: P.redBean }, orderBy: { at: "desc" } }))[0];
    expect(last).toMatchObject({ before: { imageUrl: imgs[0].url }, after: { imageUrl: imgs[1].url } });
  });

  it("deleting the last photo clears the cover", async () => {
    const [only] = await addMany(P.redBean, 1);
    const { product } = await (await remove(P.redBean, only.id)).json();
    expect(product.images).toEqual([]);
    expect(product.imageUrl).toBeNull();
    expect(await coverOf(P.redBean)).toBeNull();
    expect(storedKeys()).toEqual([]);
  });

  it("404 for an unknown photo, another product's photo, or a malformed id", async () => {
    const [mine] = await addMany(P.redBean, 1);
    const [theirs] = await addMany(P.brulee, 1);
    for (const [pid, iid] of [
      [P.redBean, UNKNOWN_ID],
      [P.redBean, theirs.id],
      [P.redBean, "nope"],
      [UNKNOWN_ID, mine.id],
    ]) {
      expect((await remove(pid, iid)).status).toBe(404);
    }
    expect(await db.productImage.count()).toBe(2);
    expect(storedKeys()).toHaveLength(2);
  });

  it("frees a slot so a 7th upload then works", async () => {
    const imgs = await addMany(P.redBean, 6);
    expect((await remove(P.redBean, imgs[5].id)).status).toBe(200);
    expect((await add(P.redBean)).status).toBe(201);
  });
});

describe("products list and the legacy single-image endpoints", () => {
  it("GET /api/admin/products carries images in order and fieldColor", async () => {
    const imgs = await addMany(P.redBean, 2);
    await order(P.redBean, [imgs[1].id, imgs[0].id]);
    const { products } = await (await LIST(new Request(`${SITE}/api/admin/products`))).json();
    const red = products.find((p: { id: string }) => p.id === P.redBean);
    expect(red.images.map((i: Img) => i.url)).toEqual([imgs[1].url, imgs[0].url]);
    expect(red.imageUrl).toBe(imgs[1].url);
    expect(red.fieldColor).toBe("#DCC5BB");
  });

  it("legacy POST /image replaces the cover in place (or adds the first photo); DELETE /image removes the cover", async () => {
    const legacy = await import("@/app/api/admin/products/[id]/image/route");
    const upload = () => {
      const form = new FormData();
      form.append("file", new File([fixture("bun.png") as BlobPart], "p.png", { type: "image/png" }));
      return legacy.POST(
        new Request(`${SITE}/api/admin/products/${P.redBean}/image`, { method: "POST", headers: { origin: SITE }, body: form }),
        ctx(P.redBean),
      );
    };
    const first = (await (await upload()).json()).product;
    expect(first.images).toHaveLength(1);
    const [, second] = await addMany(P.redBean, 1);
    const replaced = (await (await upload()).json()).product;
    expect(replaced.images).toHaveLength(2);
    expect(replaced.images[0].id).toBe(first.images[0].id);
    expect(replaced.images[0].url).not.toBe(first.images[0].url);
    expect(replaced.images[1].url).toBe(second.url);
    expect(replaced.imageUrl).toBe(replaced.images[0].url);
    expect(await getImageStore().get(keyOf(first.images[0].url))).toBeNull();

    const del = await legacy.DELETE(
      new Request(`${SITE}/api/admin/products/${P.redBean}/image`, { method: "DELETE", headers: { origin: SITE } }),
      ctx(P.redBean),
    );
    const after = (await del.json()).product;
    expect(after.images.map((i: Img) => i.url)).toEqual([second.url]);
    expect(after.imageUrl).toBe(second.url);
  });
});

describe("product colour (D95)", () => {
  const patch = (id: string, body: unknown) =>
    PATCH(
      new Request(`${SITE}/api/admin/products/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: SITE },
        body: JSON.stringify(body),
      }),
      ctx(id),
    );

  it("accepts #RRGGBB (stored upper case) and null, audits the change", async () => {
    const res = await patch(P.brulee, { fieldColor: "#b9c9a0" });
    expect(res.status).toBe(200);
    expect((await res.json()).product.fieldColor).toBe("#B9C9A0");
    expect((await db.product.findUniqueOrThrow({ where: { id: P.brulee } })).fieldColor).toBe("#B9C9A0");
    const audit = (await db.auditLog.findMany({ where: { entityId: P.brulee }, orderBy: { at: "desc" } }))[0];
    expect(audit).toMatchObject({ before: { fieldColor: "#B05219" }, after: { fieldColor: "#B9C9A0" } });
    expect((await patch(P.brulee, { fieldColor: null })).status).toBe(200);
    expect((await db.product.findUniqueOrThrow({ where: { id: P.brulee } })).fieldColor).toBeNull();
  });

  it.each(["red", "#fff", "#GGGGGG", "B9C9A0", "#B9C9A0FF", "", " #B9C9A0", 5])("rejects %j", async (bad) => {
    const res = await patch(P.brulee, { fieldColor: bad });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("VALIDATION");
    expect((await db.product.findUniqueOrThrow({ where: { id: P.brulee } })).fieldColor).toBe("#B05219");
  });

  it("a new product keeps the colour it was created with, or none", async () => {
    const base = { name: "新面包", unitPriceCents: 300, capacityMode: "INDEPENDENT", dailyLimit: 10 };
    const create = (extra: object) =>
      CREATE(
        new Request(`${SITE}/api/admin/products`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: SITE },
          body: JSON.stringify({ ...base, ...extra }),
        }),
      );
    const withColor = await create({ fieldColor: "#F2C4C9" });
    expect(withColor.status).toBe(201);
    const made = (await withColor.json()).product;
    expect(made.fieldColor).toBe("#F2C4C9");
    expect(made.images).toEqual([]);
    const plain = await create({});
    expect((await plain.json()).product.fieldColor).toBeNull();
    expect((await create({ fieldColor: "nope" })).status).toBe(422);
  });

  it("the database refuses a malformed colour even if the app were bypassed", async () => {
    await expect(db.product.update({ where: { id: P.brulee }, data: { fieldColor: "red" } })).rejects.toThrow();
  });
});

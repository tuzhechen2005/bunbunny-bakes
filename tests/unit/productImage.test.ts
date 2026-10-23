import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { needsResize, scaledSize } from "@/lib/imageResize";
import { isValidImageKey, keyFromImageUrl, sniffImage } from "@/server/imageFormat";
import { createMemoryImageStore, onNetlify } from "@/server/imageStore";

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/${name}`));
const ID = "0b8c2f4e-1a2b-4c3d-8e9f-0123456789ab";
const HEX = "0123456789abcdef0123456789abcdef";

describe("sniffImage", () => {
  it("recognises jpeg, png and webp by magic bytes", () => {
    expect(sniffImage(fixture("bun.jpg"))).toEqual({ ext: "jpg", contentType: "image/jpeg" });
    expect(sniffImage(fixture("bun.png"))).toEqual({ ext: "png", contentType: "image/png" });
    expect(sniffImage(fixture("bun.webp"))).toEqual({ ext: "webp", contentType: "image/webp" });
  });
  it("rejects pdf, html, gif, svg, riff-but-not-webp and empty/short input", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(sniffImage(enc("%PDF-1.7\n"))).toBeNull();
    expect(sniffImage(enc("<html><body>x</body></html>"))).toBeNull();
    expect(sniffImage(enc("GIF89a......"))).toBeNull();
    expect(sniffImage(enc('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImage(enc("RIFF\0\0\0\0WAVEfmt "))).toBeNull();
    expect(sniffImage(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});

describe("image keys", () => {
  it("accepts <uuid>/<32 hex>.<ext>", () => {
    for (const ext of ["jpg", "png", "webp"]) expect(isValidImageKey(`${ID}/${HEX}.${ext}`)).toBe(true);
  });
  it("rejects traversal, wrong shapes and wrong extensions", () => {
    for (const key of [
      `../${ID}/${HEX}.jpg`,
      `${ID}/../${HEX}.jpg`,
      `${ID}/${HEX}.gif`,
      `${ID}/${HEX}.jpeg`,
      `${ID}/${HEX.slice(1)}.jpg`,
      `${ID}/${HEX.toUpperCase()}.jpg`,
      `${ID}/${HEX}.jpg/extra`,
      `${ID}/${HEX}.jpg\n`,
      `/${ID}/${HEX}.jpg`,
      `${ID}${HEX}.jpg`,
      "",
      "..",
    ]) {
      expect(isValidImageKey(key), key).toBe(false);
    }
  });
  it("maps imageUrl back to a key only for our own urls", () => {
    expect(keyFromImageUrl(`/api/images/${ID}/${HEX}.png`)).toBe(`${ID}/${HEX}.png`);
    expect(keyFromImageUrl("https://example.com/a.png")).toBeNull();
    expect(keyFromImageUrl("/api/images/../x")).toBeNull();
    expect(keyFromImageUrl(null)).toBeNull();
  });
});

describe("image store selection and memory store", () => {
  it("uses Netlify only when its env is present", () => {
    expect(onNetlify({})).toBe(false);
    expect(onNetlify({ NETLIFY: "true" })).toBe(true);
    expect(onNetlify({ NETLIFY_BLOBS_CONTEXT: "x" })).toBe(true);
  });
  it("puts, gets (with content type) and deletes", async () => {
    const s = createMemoryImageStore();
    await s.put("k", new Uint8Array([1, 2, 3]), "image/png");
    expect(await s.get("k")).toEqual({ data: new Uint8Array([1, 2, 3]), contentType: "image/png" });
    await s.delete("k");
    expect(await s.get("k")).toBeNull();
    await s.delete("k"); // deleting a missing key is fine
  });
});

describe("client resize maths", () => {
  it("scales the longer edge to 1600 and never upscales", () => {
    expect(scaledSize(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(scaledSize(3000, 4000)).toEqual({ width: 1200, height: 1600 });
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
  it("resizes when over 5 MB or over 1600 px", () => {
    expect(needsResize(1000, 800, 600)).toBe(false);
    expect(needsResize(5 * 1024 * 1024 + 1, 800, 600)).toBe(true);
    expect(needsResize(1000, 1601, 100)).toBe(true);
    expect(needsResize(1000, 100, 1601)).toBe(true);
  });
});

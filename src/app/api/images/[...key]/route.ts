// Public product photos (T5.2). Keys are random, so responses are immutable.
import { isValidImageKey } from "@/server/imageFormat";
import { getImageStore } from "@/server/imageStore";

const CONTENT_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

const notFound = () =>
  new Response("Not found", { status: 404, headers: { "x-content-type-options": "nosniff" } });

export async function GET(_request: Request, context: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await context.params;
  const key = parts.join("/");
  if (!isValidImageKey(key)) return notFound();
  const image = await getImageStore().get(key);
  if (!image) return notFound();
  const body = new Uint8Array(image.data).buffer;
  return new Response(body, {
    headers: {
      // From the validated key extension, never from stored metadata.
      "content-type": CONTENT_TYPES[key.slice(key.lastIndexOf(".") + 1)],
      "content-security-policy": "default-src 'none'; sandbox",
      "content-length": String(image.data.byteLength),
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}

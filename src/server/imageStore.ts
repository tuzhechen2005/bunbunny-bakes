// Storage for product photos (T5.2, D62). Netlify Blobs when running on Netlify, an
// in-memory map everywhere else (local dev, tests: nothing ever talks to Netlify then).

import { getStore } from "@netlify/blobs";

export interface StoredImage {
  data: Uint8Array;
  contentType: string;
}

export interface ImageStore {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredImage | null>;
  delete(key: string): Promise<void>;
}

export const IMAGE_STORE_NAME = "product-images";

export function createMemoryImageStore(): ImageStore & { keys(): string[] } {
  const map = new Map<string, StoredImage>();
  return {
    async put(key, data, contentType) {
      map.set(key, { data: new Uint8Array(data), contentType });
    },
    async get(key) {
      const hit = map.get(key);
      return hit ? { data: hit.data, contentType: hit.contentType } : null;
    },
    async delete(key) {
      map.delete(key);
    },
    keys: () => [...map.keys()],
  };
}

export function createNetlifyImageStore(): ImageStore {
  const store = () => getStore({ name: IMAGE_STORE_NAME, consistency: "strong" });
  return {
    async put(key, data, contentType) {
      await store().set(key, new Blob([new Uint8Array(data)], { type: contentType }), {
        metadata: { contentType },
      });
    },
    async get(key) {
      const hit = await store().getWithMetadata(key, { type: "arrayBuffer" });
      if (!hit) return null;
      const contentType = typeof hit.metadata.contentType === "string" ? hit.metadata.contentType : "";
      return { data: new Uint8Array(hit.data), contentType };
    },
    async delete(key) {
      await store().delete(key);
    },
  };
}

/** True on Netlify (build and function runtime set NETLIFY / NETLIFY_BLOBS_CONTEXT). */
export function onNetlify(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.NETLIFY || env.NETLIFY_BLOBS_CONTEXT);
}

const globalForStore = globalThis as unknown as { __bbImageStore?: ImageStore };

/**
 * The store for this process. Kept on globalThis so every route bundle (and dev-mode
 * reloads) shares one in-memory store.
 */
export function getImageStore(): ImageStore {
  return (globalForStore.__bbImageStore ??= onNetlify() ? createNetlifyImageStore() : createMemoryImageStore());
}

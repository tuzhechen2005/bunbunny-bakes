// The menu the home page is rendered with on the server (D91). Same data as GET /api/menu (getMenu),
// kept for about a minute per server instance with `use cache`; admin writes drop it at once
// (revalidateMenu, called by adminHandler). The page refetches /api/menu on mount, so what the
// visitor sees is corrected within a moment anyway (ordering closed, a paused product).

import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import { prisma } from "./db";
import { getMenu, type Menu } from "./menu";

export const MENU_TAG = "menu";

/** Seconds the cached menu is served before it is refreshed. 0 turns the cache off (tests). */
function cacheSeconds(): number {
  const n = Number(process.env.MENU_CACHE_SECONDS ?? 60);
  return Number.isFinite(n) && n >= 0 ? n : 60;
}

async function cachedMenu(): Promise<Menu> {
  "use cache";
  cacheTag(MENU_TAG);
  const revalidate = cacheSeconds();
  cacheLife({ stale: 30, revalidate, expire: revalidate + 60 });
  return getMenu(prisma);
}

/**
 * The menu for the first render of `/`, or null when it cannot be read (database down, no Setting
 * row yet) or `HOME_INITIAL_MENU=off` (e2e: the tests then drive the menu through /api/menu).
 */
export async function getInitialMenu(): Promise<Menu | null> {
  if (process.env.HOME_INITIAL_MENU === "off") return null;
  try {
    return await cachedMenu();
  } catch {
    return null;
  }
}

/** Drops the cached menu after an admin change (products, settings, ordering switch, photos). */
export function revalidateMenu(): void {
  try {
    revalidateTag(MENU_TAG, { expire: 0 });
  } catch {
    // Outside a Next request (unit and db tests call handlers directly): nothing is cached then.
  }
}

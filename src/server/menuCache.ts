// The menu the home page is rendered with on the server (D91). Same data as GET /api/menu (getMenu),
// cached with `use cache` (MENU_CACHE_SECONDS, default 60: after that the next request refreshes it
// and may still get the old copy while it does, for up to a minute more); admin writes drop it at
// once (revalidateMenu, called by adminHandler). The page refetches /api/menu on mount, so what the
// visitor sees is corrected within a moment anyway (ordering closed, a paused product).
// Cache only the internal data: project expiry/order at request time, outside `use cache`.

import { connection } from "next/server";
import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import { prisma } from "./db";
import { getMenuData, presentMenu, type Menu, type MenuData } from "./menu";

export const MENU_TAG = "menu";

/** Seconds before the cached menu is refreshed (0: refreshed on every request, still never older than the last admin write). */
function cacheSeconds(): number {
  const n = Number(process.env.MENU_CACHE_SECONDS ?? 60);
  return Number.isFinite(n) && n >= 0 ? n : 60;
}

async function cachedMenu(): Promise<MenuData> {
  "use cache";
  cacheTag(MENU_TAG);
  const revalidate = cacheSeconds();
  cacheLife({ stale: 30, revalidate, expire: revalidate + 60 });
  return getMenuData(prisma);
}

/**
 * The menu for the first render of `/`, or null when it cannot be read (database down, no Setting
 * row yet) or `HOME_INITIAL_MENU=off` (e2e: the tests then drive the menu through /api/menu).
 */
export async function getInitialMenu(): Promise<Menu | null> {
  if (process.env.HOME_INITIAL_MENU === "off") return null;
  try {
    await connection();
    const now = new Date();
    return presentMenu(await cachedMenu(), now);
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

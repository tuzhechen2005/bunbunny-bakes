/** N1: seven elapsed days, independent of calendar dates or time zones. */
export function newProductUntil(now: Date): Date {
  return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
}

/** Customer projection: remove internal expiry and stably put new products first. */
export function presentNewProducts<T extends { newUntil: Date | null }>(
  products: readonly T[],
  now: Date,
): (Omit<T, "newUntil"> & { isNew: boolean })[] {
  return products.map(({ newUntil, ...product }) => ({
    ...product,
    isNew: newUntil !== null && now.getTime() < newUntil.getTime(),
  })).sort((a, b) => Number(b.isNew) - Number(a.isNew));
}

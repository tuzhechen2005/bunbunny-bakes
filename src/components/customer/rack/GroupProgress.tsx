"use client";

import { useEffect, useState } from "react";
import { copy } from "@/copy";
import { dayLabel } from "@/domain/dates";
import type { MenuProduct } from "@/lib/api";
import { fill } from "../format";

const t = copy.customer.group;
/** Dates shown under the flavours: the next few that can still be joined. */
const SHOW = 3;

export interface PublicPool {
  date: string;
  productId: string;
  flavorId: string | null;
  min: number;
  last: number;
  cakes: number;
  needMore: number;
  status: "OPEN" | "FORMED" | "CONFIRMED" | "FAILED";
}

// One fetch per product per page view is plenty: the bar is a hint, the order itself is checked on the server.
const cache = new Map<string, Promise<PublicPool[]>>();
function poolsOf(productId: string): Promise<PublicPool[]> {
  let p = cache.get(productId);
  if (!p) {
    p = fetch(`/api/group-pools?productId=${encodeURIComponent(productId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { pools: [] }))
      .then((j: { pools?: PublicPool[] }) => j.pools ?? [])
      .catch(() => []);
    cache.set(productId, p);
    // A later open gets fresh numbers.
    setTimeout(() => cache.delete(productId), 60_000);
  }
  return p;
}

export interface Projection {
  /** Pieces of the cake being filled, before and with the customer's own. */
  before: number;
  after: number;
  min: number;
  /** The customer's pieces make (or keep) this cake going. */
  formed: boolean;
  /** Owner already confirmed it (or it was ordered before 拼单 started): it will be made either way. */
  confirmed: boolean;
  needMore: number;
  /** Pieces left in a confirmed cake after the customer's. */
  spare: number;
}

/**
 * The pool as it would be with `mine` more pieces (D192, live while the customer picks): the cake being filled
 * is the last one after adding; pieces beyond a confirmed cake start a new one that needs its own threshold.
 */
export function projectPool(
  pool: Pick<PublicPool, "min" | "last" | "cakes" | "status">,
  batch: number,
  mine: number,
): Projection {
  const b = Math.max(1, batch);
  const total = pool.cakes > 0 ? (pool.cakes - 1) * b + pool.last : 0;
  const after = total + Math.max(0, mine);
  const cakesAfter = Math.ceil(after / b);
  const lastAfter = after ? after - (cakesAfter - 1) * b : 0;
  // A confirmed pool covers the cakes it already had; a new cake started by the customer's pieces is not confirmed.
  const confirmed = pool.status === "CONFIRMED" && cakesAfter <= pool.cakes;
  const sameCake = cakesAfter === pool.cakes || pool.cakes === 0;
  const before = sameCake ? (pool.cakes === 0 ? 0 : pool.last) : 0;
  const formed = confirmed || lastAfter >= pool.min || (pool.status === "FORMED" && cakesAfter <= pool.cakes);
  return {
    before: Math.min(before, lastAfter),
    after: lastAfter,
    min: pool.min,
    formed,
    confirmed,
    needMore: formed ? 0 : Math.max(0, pool.min - lastAfter),
    spare: cakesAfter * b - after,
  };
}

/**
 * The bar: the pieces already ordered, then the customer's own in a lighter tone, towards the threshold.
 * Full and red once the cake will be made. `mine` = pieces in this customer's hands right now.
 */
export function PoolBar({
  pool,
  batch,
  mine = 0,
  testId,
}: Readonly<{ pool: Pick<PublicPool, "min" | "last" | "needMore" | "status" | "cakes">; batch: number; mine?: number; testId?: string }>) {
  const p = projectPool(pool, batch, mine);
  const scale = (n: number) => `${Math.round((Math.min(n, p.min) / Math.max(1, p.min)) * 100)}%`;
  const label =
    pool.status === "FAILED"
      ? t.failed
      : p.confirmed
        ? fill(t.confirmed, { spare: p.spare })
        : p.formed
          ? mine > 0 && pool.status !== "FORMED" ? t.formsWithYou : t.formed
          : mine > 0
            ? fill(t.progressMine, { have: p.after, min: p.min, mine, more: p.needMore })
            : fill(t.progress, { have: p.after, min: p.min, more: p.needMore });
  return (
    <span className="hm-pool" data-formed={p.formed ? "true" : undefined} data-testid={testId}>
      <span className="hm-pool-track" role="progressbar" aria-valuemin={0} aria-valuemax={p.min} aria-valuenow={Math.min(p.after, p.min)}>
        <i className="is-mine" style={{ width: p.formed ? "100%" : scale(p.after) }} />
        <i style={{ width: p.formed && !p.confirmed && mine === 0 ? "100%" : p.confirmed ? "100%" : scale(p.before) }} />
      </span>
      <span className="hm-pool-t">{label}</span>
    </span>
  );
}

/**
 * D192 on the detail page: under the flavours, the next open dates of the chosen flavour, each with its bar
 * ("周二 11/10 ━━━━── 3/4 块 · 还差 1 块"). Before a flavour is chosen, only the rule line.
 */
export function GroupProgress({ product, flavorId, mine }: Readonly<{ product: MenuProduct; flavorId: string | null; mine: number }>) {
  const [pools, setPools] = useState<PublicPool[] | null>(null);
  useEffect(() => {
    let live = true;
    void poolsOf(product.id).then((p) => live && setPools(p));
    return () => {
      live = false;
    };
  }, [product.id]);

  const needFlavor = (product.flavors?.length ?? 0) > 0;
  const rows = (pools ?? [])
    .filter((p) => p.status !== "FAILED" && (needFlavor ? p.flavorId === flavorId : p.flavorId === null))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, SHOW);
  return (
    <div className="hm-dt-lead hm-dt-group" data-testid="detail-group">
      <p className="m-0 font-semibold">{fill(t.rule, { min: product.groupMin ?? 0, size: product.batchYield ?? 0 })}</p>
      {needFlavor && !flavorId ? null : rows.length > 0 ? (
        <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
          {rows.map((p) => (
            <li key={p.date} className="flex items-center gap-3" data-testid="detail-pool">
              <span className="w-[86px] shrink-0">{dayLabel(p.date)}</span>
              <PoolBar pool={p} batch={product.batchYield ?? 1} mine={mine} />
            </li>
          ))}
        </ul>
      ) : pools ? (
        <p className="m-0 mt-1">{t.noDates}</p>
      ) : null}
    </div>
  );
}

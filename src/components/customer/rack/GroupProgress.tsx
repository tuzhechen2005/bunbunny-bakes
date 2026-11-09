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

/** The bar itself: a thin line that fills towards the threshold; full once the cake will be made. */
export function PoolBar({ pool, testId }: Readonly<{ pool: Pick<PublicPool, "min" | "last" | "needMore" | "status" | "cakes">; testId?: string }>) {
  const formed = pool.status === "FORMED" || pool.status === "CONFIRMED";
  // The cake being filled now: a full earlier cake does not make this one count as started.
  const have = formed ? pool.min : Math.min(pool.min, pool.cakes === 0 ? 0 : pool.last);
  const pct = Math.round((have / Math.max(1, pool.min)) * 100);
  return (
    <span className="hm-pool" data-formed={formed ? "true" : undefined} data-testid={testId}>
      <span className="hm-pool-track" role="progressbar" aria-valuemin={0} aria-valuemax={pool.min} aria-valuenow={have}>
        <i style={{ width: `${pct}%` }} />
      </span>
      <span className="hm-pool-t">
        {formed ? t.formed : pool.status === "FAILED" ? t.failed : fill(t.progress, { have, min: pool.min, more: pool.needMore || pool.min - have })}
      </span>
    </span>
  );
}

/**
 * D192 on the detail page: under the flavours, the next open dates of the chosen flavour, each with its bar
 * ("周二 11/10 ━━━━── 3/4 块 · 还差 1 块"). Before a flavour is chosen, only the rule line.
 */
export function GroupProgress({ product, flavorId }: Readonly<{ product: MenuProduct; flavorId: string | null }>) {
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
              <PoolBar pool={p} />
            </li>
          ))}
        </ul>
      ) : pools ? (
        <p className="m-0 mt-1">{t.noDates}</p>
      ) : null}
    </div>
  );
}

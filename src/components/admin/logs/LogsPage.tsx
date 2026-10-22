"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { PageHeader } from "@/components/admin/PageHeader";
import { copy } from "@/copy";
import { adminApi } from "@/lib/adminApi";
import { diffLines } from "./diff";

const t = copy.admin.logs;

interface LogItem {
  id: string;
  at: string;
  atLabel: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  orderNo: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
}
interface LogsResponse {
  items: LogItem[];
  nextCursor: string | null;
}

function actionLabel(action: string): string {
  const map = t.actions as Record<string, string>;
  return Object.prototype.hasOwnProperty.call(map, action) ? map[action] : action;
}

function actorLabel(actor: string): string {
  const map = t.actors as Record<string, string>;
  return Object.prototype.hasOwnProperty.call(map, actor) ? map[actor] : actor;
}

function LogEntry({ item }: Readonly<{ item: LogItem }>) {
  const lines = diffLines(item.before, item.after);
  const isOrder = item.entityType === "Order";
  return (
    <li className="rounded-xl border border-line bg-card p-3" data-testid="log-entry">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-semibold">{actionLabel(item.action)}</span>
        {item.orderNo && (
          <span className="text-sm text-muted">{t.orderPrefix.replace("{orderNo}", item.orderNo)}</span>
        )}
      </div>
      <div className="text-sm text-muted">
        {item.atLabel} · {actorLabel(item.actor)}
      </div>
      {lines.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {lines.map((l) => (
            <li key={l.key} className="break-words">
              <span className="text-muted">{l.label}：</span>
              {l.from !== null && (
                <>
                  <span>{l.from}</span>
                  <span className="mx-1 text-muted">{t.arrow}</span>
                </>
              )}
              <span className="font-medium">{l.to}</span>
            </li>
          ))}
        </ul>
      )}
      {item.reason && (
        <p className="mt-2 rounded-lg bg-soft px-3 py-2 text-sm font-medium break-words">
          {t.reason}：{item.reason}
        </p>
      )}
      {isOrder && (
        <Link
          href={`/admin/orders/${item.entityId}`}
          className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-accent-strong underline"
        >
          {t.orderLink}
        </Link>
      )}
    </li>
  );
}

export function LogsPage() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<LogItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ignores the answer of a request that a newer search has replaced.
  const generation = useRef(0);

  const loadFirst = useCallback(async (q: string) => {
    const mine = ++generation.current;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    const result = await adminApi<LogsResponse>(`/api/admin/logs?${params.toString()}`);
    if (mine !== generation.current) return;
    setLoading(false);
    if (result.ok) {
      setItems(result.data.items);
      setNextCursor(result.data.nextCursor);
    } else if (result.error !== "UNAUTHORIZED") {
      setItems([]);
      setNextCursor(null);
      setError(result.message || t.loadFailed);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-side data load on search change
    void loadFirst(query);
  }, [query, loadFirst]);

  async function onMore() {
    if (!nextCursor || loadingMore) return;
    const mine = generation.current;
    setLoadingMore(true);
    setError(null);
    const params = new URLSearchParams({ cursor: nextCursor });
    if (query) params.set("q", query);
    const result = await adminApi<LogsResponse>(`/api/admin/logs?${params.toString()}`);
    setLoadingMore(false);
    if (mine !== generation.current) return;
    if (result.ok) {
      setItems((prev) => [...prev, ...result.data.items]);
      setNextCursor(result.data.nextCursor);
    } else if (result.error !== "UNAUTHORIZED") {
      setError(result.message || t.loadFailed);
    }
  }

  function onSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setQuery(input.trim());
  }

  function onClear() {
    setInput("");
    setQuery("");
  }

  return (
    <>
      <PageHeader title={t.title} />
      <form onSubmit={onSearch} className="mb-4 flex gap-2" role="search">
        <input
          type="search"
          name="q"
          aria-label={t.searchLabel}
          placeholder={t.searchPlaceholder}
          autoCapitalize="none"
          autoCorrect="off"
          maxLength={100}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-2 text-base text-foreground focus:border-accent focus:outline-none"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button
          type="submit"
          className="min-h-11 shrink-0 rounded-lg bg-accent px-4 text-base font-medium text-accent-ink"
        >
          {t.search}
        </button>
        {(query || input) && (
          <button
            type="button"
            onClick={onClear}
            className="min-h-11 shrink-0 rounded-lg border border-line px-3 text-base"
          >
            {t.clear}
          </button>
        )}
      </form>

      {error && (
        <p role="alert" className="mb-3 text-danger">
          {error}
        </p>
      )}
      {loading ? (
        <p className="text-muted">{t.loading}</p>
      ) : items.length === 0 && !error ? (
        <AdminCard>
          <p className="text-muted">{t.empty}</p>
        </AdminCard>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <LogEntry key={item.id} item={item} />
          ))}
        </ul>
      )}

      {!loading && nextCursor && (
        <button
          type="button"
          onClick={() => void onMore()}
          disabled={loadingMore}
          className="mt-4 min-h-11 w-full rounded-lg border border-line bg-card px-4 text-base font-medium disabled:bg-disabled disabled:text-disabled-ink"
        >
          {loadingMore ? t.loadingMore : t.loadMore}
        </button>
      )}
    </>
  );
}

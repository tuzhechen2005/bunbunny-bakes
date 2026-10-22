"use client";

// Loads the form data (and, when editing, the order) through the admin APIs, then renders
// the form. Data is fetched client-side so nothing is rendered without an API session check.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { copy } from "@/copy";
import { adminApi } from "@/lib/adminApi";
import type { EditableOrder } from "@/lib/orderForm";
import type { OrderFormData } from "@/server/orderForm";
import { AdminCard } from "../AdminCard";
import { PageHeader } from "../PageHeader";
import { OrderForm } from "./OrderForm";

const t = copy.admin.orderForm;

type State =
  | { status: "loading" }
  | { status: "error"; message: string; notFound?: boolean }
  | { status: "ready"; data: OrderFormData; order?: EditableOrder };

export function OrderFormLoader({ orderId }: Readonly<{ orderId?: string }>) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [tick, setTick] = useState(0);

  const load = useCallback(async (): Promise<State> => {
    const [form, order] = await Promise.all([
      adminApi<OrderFormData>("/api/admin/order-form"),
      orderId ? adminApi<EditableOrder>(`/api/admin/orders/${encodeURIComponent(orderId)}`) : null,
    ]);
    if (!form.ok) return { status: "error", message: form.message };
    if (order && !order.ok) {
      return { status: "error", message: order.message, notFound: order.error === "NOT_FOUND" };
    }
    return { status: "ready", data: form.data, order: order?.ok ? order.data : undefined };
  }, [orderId]);

  useEffect(() => {
    let cancelled = false;
    void load().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [load, tick]);

  const title = orderId
    ? state.status === "ready" && state.order
      ? t.editTitle.replace("{orderNo}", state.order.orderNo)
      : t.editTitleShort
    : t.newTitle;
  const back = orderId ? `/admin/orders/${orderId}` : "/admin";

  return (
    <>
      <PageHeader title={state.status === "error" && state.notFound ? t.notFound : title} backHref={back} />
      {state.status === "loading" ? (
        <p className="text-muted" role="status">
          {t.loading}
        </p>
      ) : state.status === "error" ? (
        <AdminCard>
          <p role="alert" className="text-danger">
            {state.notFound ? t.notFound : state.message || t.loadFailed}
          </p>
          <div className="mt-3 flex gap-3">
            {state.notFound ? null : (
              <button
                type="button"
                className="min-h-11 rounded-full border border-accent px-5 text-accent"
                onClick={() => {
                  setState({ status: "loading" });
                  setTick((n) => n + 1);
                }}
              >
                {t.retry}
              </button>
            )}
            <Link href="/admin/orders" className="flex min-h-11 items-center text-accent underline">
              {t.backToOrders}
            </Link>
          </div>
        </AdminCard>
      ) : (
        <OrderForm key={state.order?.updatedAt ?? "new"} data={state.data} order={state.order} />
      )}
    </>
  );
}

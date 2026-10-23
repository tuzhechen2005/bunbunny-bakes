import { Suspense } from "react";
import { OrderLoading } from "@/components/order/OrderLoading";
import { OrderPage } from "@/components/order/OrderPage";

// Static shell only: the order is fetched on the client from /api/o/{token},
// so no order data is ever prerendered or cached on the server.
export default function Page() {
  return (
    <main className="mx-auto flex w-full max-w-[430px] flex-1 flex-col">
      <Suspense fallback={<OrderLoading />}>
        <OrderPage />
      </Suspense>
    </main>
  );
}

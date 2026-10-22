import { copy } from "@/copy";

/** Neutral loading state (no order skeleton, so a 404 never flashes an order layout). */
export function OrderLoading() {
  return (
    <p role="status" className="px-4 py-16 text-center text-base text-neutral-500">
      {copy.customer.order.loading}
    </p>
  );
}

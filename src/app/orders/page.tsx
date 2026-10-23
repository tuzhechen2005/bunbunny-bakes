import { MyOrders } from "@/components/customer/MyOrders";

// Static shell: the list lives in this browser's localStorage and each order is fetched
// on the client from /api/o/{token}, so nothing about any order is prerendered.
export default function Page() {
  return <MyOrders />;
}

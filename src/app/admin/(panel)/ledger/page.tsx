import type { Metadata } from "next";
import { LedgerPage } from "@/components/admin/ledger/LedgerPage";
import { copy } from "@/copy";

export const metadata: Metadata = {
  title: `${copy.admin.ledger.title} · ${copy.shopName}`,
};

// No data is read on the server: the page loads /api/admin/ledger client-side.
export default function AdminLedgerPage() {
  return <LedgerPage />;
}

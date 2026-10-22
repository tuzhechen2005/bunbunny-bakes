import type { Metadata } from "next";
import { LogsPage } from "@/components/admin/logs/LogsPage";
import { copy } from "@/copy";

export const metadata: Metadata = {
  title: `${copy.admin.logs.title} · ${copy.shopName}`,
};

// No data is read on the server: the page loads /api/admin/logs client-side.
export default function AdminLogsPage() {
  return <LogsPage />;
}

import type { Metadata } from "next";
import { SettingsPage } from "@/components/admin/settings/SettingsPage";
import { copy } from "@/copy";

export const metadata: Metadata = {
  title: `${copy.admin.settings.title} · ${copy.shopName}`,
};

// No data is read on the server: the page loads /api/admin/settings client-side.
export default function AdminSettingsPage() {
  return <SettingsPage />;
}

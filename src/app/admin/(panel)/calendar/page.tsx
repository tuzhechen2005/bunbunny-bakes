import type { Metadata } from "next";
import { CalendarView } from "@/components/admin/calendar/CalendarView";
import { PageHeader } from "@/components/admin/PageHeader";
import { copy } from "@/copy";

export const metadata: Metadata = {
  title: `${copy.admin.calendar.title} · ${copy.shopName}`,
};

// Data is loaded client-side through the adminHandler-protected API.
export default function AdminCalendarPage() {
  return (
    <>
      <PageHeader title={copy.admin.calendar.title} />
      <CalendarView />
    </>
  );
}

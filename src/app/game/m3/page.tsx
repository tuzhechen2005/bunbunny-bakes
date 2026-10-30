import type { Metadata } from "next";
import { M3Page } from "@/components/m3/M3Page";
import { copy } from "@/copy";

export const metadata: Metadata = {
  title: `${copy.customer.m3.pageTitle} · ${copy.shopName}`,
};

// Static shell; the run, the board and the leaderboard load on the client.
export default function M3() {
  return <M3Page />;
}

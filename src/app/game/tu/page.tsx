import type { Metadata } from "next";
import { TuPage } from "@/components/tu/TuPage";
import { copy } from "@/copy";

export const metadata: Metadata = {
  title: `${copy.customer.tu.pageTitle} · ${copy.shopName}`,
};

// Static shell; the run, the board and the leaderboard load on the client.
export default function Tu() {
  return <TuPage />;
}

import type { Metadata } from "next";
import { RunPage } from "@/components/run/RunPage";
import { copy } from "@/copy";

export const metadata: Metadata = {
  title: `${copy.customer.run.pageTitle} · ${copy.shopName}`,
};

// Static shell; the run, the board and the leaderboard load on the client.
export default function Run() {
  return <RunPage />;
}

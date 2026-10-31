import type { Metadata } from "next";
import { GrabPage } from "@/components/grab/GrabPage";
import { copy } from "@/copy";

export const metadata: Metadata = {
  title: `${copy.customer.grab.pageTitle} · ${copy.shopName}`,
};

// Static shell; the run, the board and the leaderboard load on the client.
export default function Grab() {
  return <GrabPage />;
}

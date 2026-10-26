import type { Metadata } from "next";
import { GamePage } from "@/components/game/GamePage";
import { copy } from "@/copy";

export const metadata: Metadata = {
  title: `${copy.customer.game.pageTitle} · ${copy.shopName}`,
};

// Static shell; the run, the board and the leaderboard load on the client.
export default function Game() {
  return <GamePage />;
}

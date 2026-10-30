import type { Metadata } from "next";
import { GameHubPage } from "@/components/game/GameHubPage";
import { copy } from "@/copy";

export const metadata: Metadata = { title: `${copy.customer.gameHub.title} · ${copy.shopName}` };

export default function Hub() {
  return <GameHubPage />;
}

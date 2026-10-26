import type { Metadata } from "next";
import { GamePage } from "@/components/admin/game/GamePage";
import { copy } from "@/copy";

export const metadata: Metadata = {
  title: `${copy.admin.game.title} · ${copy.shopName}`,
};

// No data is read on the server: the panels load /api/admin/game/** client-side.
export default function AdminGamePage() {
  return <GamePage />;
}

import { copy } from "@/copy";
import type { GameKind } from "@/generated/prisma/enums";

export type { GameKind };

/** Only shipped games belong here. Add future games when their routes are enabled. */
export const GAME_CATALOG: readonly { kind: GameKind; name: string; href: string }[] = [
  { kind: "BIG", name: copy.customer.game.title, href: "/game" },
  { kind: "TU", name: copy.customer.tu.title, href: "/game/tu" },
  { kind: "M3", name: copy.customer.m3.title, href: "/game/m3" },
];

export interface GameHub {
  week: { start: string; end: string };
  prizeGame: GameKind;
  games: { kind: GameKind; name: string; href: string; weekBest: number | null }[];
}

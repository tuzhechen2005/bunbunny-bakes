import type { Page } from "@playwright/test";
import { copy } from "../../../src/copy";

export const hubFixture = (prizeGame: "BIG" | "TU" = "BIG", big: number | null = 1280, tu: number | null = 640) => ({
  week: { start: "2026-10-26", end: "2026-11-01" },
  prizeGame,
  games: [
    { kind: "BIG", name: copy.customer.game.title, href: "/game", weekBest: big },
    { kind: "TU", name: copy.customer.tu.title, href: "/game/tu", weekBest: tu },
  ],
});

export async function mockGameHub(page: Page, prizeGame: "BIG" | "TU" = "BIG") {
  await page.route("**/api/game/hub", (route) => route.fulfill({ json: hubFixture(prizeGame) }));
}

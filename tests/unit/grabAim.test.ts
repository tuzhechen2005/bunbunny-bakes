import { expect, it } from "vitest";
import { createGrabGame, GRAB_ENGINE_VERSION, TICKS_PER_SECOND } from "@/lib/grab";
import { aimGrabBread } from "../support/grabAim";

const seed = `v${GRAB_ENGINE_VERSION}.abcdef0123456789`;
const tiers = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}` }));

it("aims both browser-test deliveries, including the narrower window after the first bread", () => {
  const game = createGrabGame({ seed, tiers });
  const launches: number[] = [];
  game.step(6);
  for (let index = 0; index < 2; index++) {
    const aim = aimGrabBread(game.state());
    expect(aim.margin).toBeGreaterThanOrEqual(1);
    // This second board has no seven-tick bread window: the old ±3 search failed.
    if (index === 1) expect(aim.margin).toBe(2);
    for (let offset = -aim.margin; offset <= aim.margin; offset++) {
      const replay = createGrabGame({ seed, tiers });
      launches.forEach(tick => replay.launch(tick));
      replay.step(game.state().tick);
      const before = replay.score;
      expect(replay.launch(aim.tick + offset)).toBe(true);
      const events = replay.step(aim.tick + offset + 8 * TICKS_PER_SECOND);
      expect(events.find(event => event.type === "pop")).toMatchObject({ item: { kind: "bread" } });
      expect(replay.score).toBeGreaterThan(before);
      expect(replay.state().claw.phase).toBe("idle");
    }
    game.launch(aim.tick);
    launches.push(aim.tick);
    game.step(aim.tick + 8 * TICKS_PER_SECOND + 12);
  }
});

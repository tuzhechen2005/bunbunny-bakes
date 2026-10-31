import { expect, it } from "vitest";
import { createGrabGame, GRAB_ENGINE_VERSION, TICKS_PER_SECOND } from "@/lib/grab";
import { aimGrabBread } from "../support/grabAim";

const tiers = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}` }));

it.each([
  { seed: `v${GRAB_ENGINE_VERSION}.abcdef0123456789`, secondMargin: 8 },
  // Retain the narrow-window fixture as a raw RNG seed under the current rules.
  { seed: "v2.abcdef0123456789", secondMargin: 2 },
])("aims both deliveries for $seed within their actual hit windows", ({ seed, secondMargin }) => {
  const game = createGrabGame({ seed, tiers });
  const launches: number[] = [];
  game.step(6);
  for (let index = 0; index < 2; index++) {
    const aim = aimGrabBread(game.state());
    expect(aim.margin).toBeGreaterThanOrEqual(1);
    if (index === 1) expect(aim.margin).toBe(secondMargin);
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

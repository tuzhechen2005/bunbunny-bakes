import { describe, expect, it } from "vitest";
import { planRoll } from "@/components/customer/rack/roll";

describe("planRoll (rolling price digits)", () => {
  it("only the digits that change animate; the last digit moves first", () => {
    const plan = planRoll("$2.49", "$2.99");
    expect(plan.up).toBe(true);
    expect(plan.slots.map((s) => s.changed)).toEqual([false, false, false, true, false]);
    expect(plan.slots[3]).toMatchObject({ from: "4", to: "9", delayMs: 30 });
    expect(plan.slots[4].delayMs).toBe(0);
  });

  it("a longer number grows to the left: everything is right aligned, new slots roll in from nothing", () => {
    const plan = planRoll("$9.99", "$10.99");
    expect(plan.up).toBe(true);
    expect(plan.slots).toHaveLength(6);
    expect(plan.slots[0]).toMatchObject({ from: "", to: "$", changed: true });
    expect(plan.slots[1]).toMatchObject({ from: "$", to: "1", changed: true });
    expect(plan.slots[5]).toMatchObject({ from: "9", to: "9", changed: false });
  });

  it("going down flips the direction", () => {
    expect(planRoll("$11.48", "$8.99").up).toBe(false);
    expect(planRoll("$8.99", "$8.99").up).toBe(true);
  });

  it("a slot that exists only in the longer string has nothing to roll out", () => {
    expect(planRoll("5", "15").slots[0]).toMatchObject({ from: "", to: "1", changed: true });
    expect(planRoll("15", "5").slots[0]).toMatchObject({ from: "1", to: "", changed: true });
  });

  it("no change means nothing animates", () => {
    expect(planRoll("$2.49", "$2.49").slots.every((s) => !s.changed)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { copy } from "@/copy";
import type { OrderStatus } from "@/domain/types";
import {
  FORWARD_CHAIN,
  adminTransition,
  correctStatus,
  correctionReoccupies,
  customerCanCancel,
  customerStatusText,
  entersConfirmed,
  isOccupying,
  isTerminal,
  type CustomerStatusInput,
  type TransitionCheck,
} from "@/domain/status";

const ALL: OrderStatus[] = [
  "NEW",
  "CONTACTED",
  "CONFIRMED",
  "BAKING",
  "READY",
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
];

// Legend: "-" not ok, "F" ok without reason, "R" ok with reason required.
type Cell = "-" | "F" | "R";
const toCheck = (c: Cell): TransitionCheck =>
  c === "-" ? { ok: false } : { ok: true, reasonRequired: c === "R" };

// Rows = from, columns = to, both in ALL order:
//               NEW  CONT CONF BAKE READ COMP CANC REJ
const ADMIN: Record<OrderStatus, Cell[]> = {
  NEW:       ["-", "F", "F", "F", "F", "F", "R", "R"],
  CONTACTED: ["-", "-", "F", "F", "F", "F", "R", "R"],
  CONFIRMED: ["-", "-", "-", "F", "F", "F", "R", "-"],
  BAKING:    ["-", "-", "-", "-", "F", "F", "R", "-"],
  READY:     ["-", "-", "-", "-", "-", "F", "R", "-"],
  COMPLETED: ["-", "-", "-", "-", "-", "-", "-", "-"],
  CANCELLED: ["-", "-", "-", "-", "-", "-", "-", "-"],
  REJECTED:  ["-", "-", "-", "-", "-", "-", "-", "-"],
};

describe("FORWARD_CHAIN", () => {
  it("is the six forward statuses in order", () => {
    expect(FORWARD_CHAIN).toEqual([
      "NEW",
      "CONTACTED",
      "CONFIRMED",
      "BAKING",
      "READY",
      "COMPLETED",
    ]);
  });
});

describe("isOccupying / isTerminal", () => {
  const occupying: Record<OrderStatus, boolean> = {
    NEW: true,
    CONTACTED: true,
    CONFIRMED: true,
    BAKING: true,
    READY: true,
    COMPLETED: true,
    CANCELLED: false,
    REJECTED: false,
  };
  const terminal: Record<OrderStatus, boolean> = {
    NEW: false,
    CONTACTED: false,
    CONFIRMED: false,
    BAKING: false,
    READY: false,
    COMPLETED: true,
    CANCELLED: true,
    REJECTED: true,
  };
  for (const s of ALL) {
    it(`${s}: occupying=${occupying[s]}, terminal=${terminal[s]}`, () => {
      expect(isOccupying(s)).toBe(occupying[s]);
      expect(isTerminal(s)).toBe(terminal[s]);
    });
  }
});

describe("adminTransition (exhaustive 8x8)", () => {
  for (const from of ALL) {
    ALL.forEach((to, i) => {
      const expected = toCheck(ADMIN[from][i]);
      it(`${from} -> ${to}: ${JSON.stringify(expected)}`, () => {
        expect(adminTransition(from, to)).toEqual(expected);
      });
    });
  }
});

describe("correctStatus (exhaustive 8x8)", () => {
  for (const from of ALL) {
    for (const to of ALL) {
      const expected: TransitionCheck =
        from === to ? { ok: false } : { ok: true, reasonRequired: true };
      it(`${from} -> ${to}: ${JSON.stringify(expected)}`, () => {
        expect(correctStatus(from, to)).toEqual(expected);
      });
    }
  }
});

describe("entersConfirmed", () => {
  it.each<[OrderStatus, OrderStatus, boolean]>([
    ["NEW", "CONFIRMED", true],
    ["NEW", "COMPLETED", true],
    ["CONTACTED", "BAKING", true],
    ["CONTACTED", "READY", true],
    ["CONFIRMED", "READY", false],
    ["NEW", "CONTACTED", false],
    ["NEW", "CANCELLED", false],
    ["NEW", "REJECTED", false],
    ["CONFIRMED", "CONFIRMED", false],
  ])("%s -> %s = %s", (from, to, expected) => {
    expect(entersConfirmed(from, to)).toBe(expected);
  });
});

describe("correctionReoccupies", () => {
  it.each<[OrderStatus, OrderStatus, boolean]>([
    ["CANCELLED", "NEW", true],
    ["REJECTED", "CONFIRMED", true],
    ["COMPLETED", "READY", false],
    ["READY", "CANCELLED", false],
    ["CANCELLED", "REJECTED", false],
  ])("%s -> %s = %s", (from, to, expected) => {
    expect(correctionReoccupies(from, to)).toBe(expected);
  });
});

describe("customerCanCancel", () => {
  const cutoffAt = new Date("2026-10-29T20:00:00-05:00");
  const before = new Date(cutoffAt.getTime() - 1000);
  const after = new Date(cutoffAt.getTime() + 1000);
  const cancellable: OrderStatus[] = ["NEW", "CONTACTED", "CONFIRMED"];

  for (const s of ALL) {
    const allowed = cancellable.includes(s);
    it(`${s}: 1 s before cutoff -> ${allowed}`, () => {
      expect(customerCanCancel(s, before, cutoffAt)).toBe(allowed);
    });
    it(`${s}: exactly at cutoff -> false`, () => {
      expect(customerCanCancel(s, cutoffAt, cutoffAt)).toBe(false);
    });
    it(`${s}: after cutoff -> false`, () => {
      expect(customerCanCancel(s, after, cutoffAt)).toBe(false);
    });
  }
});

describe("customerStatusText", () => {
  const base: CustomerStatusInput = {
    status: "NEW",
    fulfillment: "PICKUP",
    hasDoughItem: false,
    ownerWechatId: "bunbunny_owner",
    bakingTextBread: "面包发酵中",
    bakingTextOther: "正在制作",
  };
  const text = (over: Partial<CustomerStatusInput>) =>
    customerStatusText({ ...base, ...over });
  const pending = copy.customerStatus.pending.replace(
    "{ownerWechatId}",
    "bunbunny_owner",
  );

  it("NEW and CONTACTED -> pending with WeChat id filled", () => {
    expect(text({ status: "NEW" })).toBe(pending);
    expect(text({ status: "CONTACTED" })).toBe(pending);
    expect(pending).toContain("bunbunny_owner");
    expect(pending).not.toContain("{ownerWechatId}");
  });

  it("CONFIRMED -> confirmed", () => {
    expect(text({ status: "CONFIRMED" })).toBe(copy.customerStatus.confirmed);
  });

  it("BAKING with dough item -> bakingTextBread", () => {
    expect(text({ status: "BAKING", hasDoughItem: true })).toBe("面包发酵中");
  });

  it("BAKING without dough item -> bakingTextOther", () => {
    expect(text({ status: "BAKING", hasDoughItem: false })).toBe("正在制作");
  });

  it("READY + PICKUP -> readyPickup", () => {
    expect(text({ status: "READY", fulfillment: "PICKUP" })).toBe(
      copy.customerStatus.readyPickup,
    );
  });

  it("READY + DELIVERY -> readyDelivery", () => {
    expect(text({ status: "READY", fulfillment: "DELIVERY" })).toBe(
      copy.customerStatus.readyDelivery,
    );
  });

  it("COMPLETED -> completed", () => {
    expect(text({ status: "COMPLETED" })).toBe(copy.customerStatus.completed);
  });

  it("CANCELLED and REJECTED -> cancelled", () => {
    expect(text({ status: "CANCELLED" })).toBe(copy.customerStatus.cancelled);
    expect(text({ status: "REJECTED" })).toBe(copy.customerStatus.cancelled);
  });
});

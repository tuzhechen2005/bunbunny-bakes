// Type-level guard (checked by `npx tsc --noEmit`): the lock helpers must not accept
// the root client. Outside an interactive transaction, FOR UPDATE autocommits and
// the lock is released immediately, which would allow overselling.

import { describe, expect, it } from "vitest";
import { prisma, type Tx } from "@/server/db";
import { loadDayContext, loadProductMap, loadSettings, lockOpenDate, lockOpenDates } from "@/server/day";
import { writeAudit } from "@/server/audit";
import { enqueueNotification } from "@/server/outbox";

// Never called: only compiled.
export function typeChecks(): void {
  // @ts-expect-error the root client is not a transaction client
  void lockOpenDate(prisma, "2026-10-24");
  // @ts-expect-error the root client is not a transaction client
  void lockOpenDates(prisma, ["2026-10-24"]);
  // @ts-expect-error the root client is not a transaction client
  void loadSettings(prisma);
  // @ts-expect-error the root client is not a transaction client
  void loadProductMap(prisma);
  // @ts-expect-error the root client is not a transaction client
  void loadDayContext(prisma, "2026-10-24", { defaultDoughLimitG: 1, defaultDeliveryLimit: 1 }, {});
  // @ts-expect-error the root client is not a transaction client
  void writeAudit(prisma, { actor: "SYSTEM", action: "x", entityType: "x", entityId: "x", at: new Date() });
  void enqueueNotification(
    // @ts-expect-error the root client is not a transaction client
    prisma,
    { kind: "NEW_ORDER", dedupeKey: "k", payload: {}, now: new Date() },
  );

  // The interactive-transaction client is accepted.
  void prisma.$transaction(async (tx) => {
    const t: Tx = tx;
    await lockOpenDate(t, "2026-10-24");
    await lockOpenDates(tx, ["2026-10-24"]);
    await loadSettings(tx);
  });
}

describe("Tx type", () => {
  it("is enforced at compile time (see @ts-expect-error lines above)", () => {
    expect(typeof typeChecks).toBe("function");
  });
});

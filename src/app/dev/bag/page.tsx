import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BagHarness } from "./BagHarness";

// Test-only page for tests/e2e/bag.spec.ts: the real BagBar + FlyLayer on a stand-in page. It is
// a 404 unless the server (or the build) runs with BAG_HARNESS=1; only the Playwright config sets
// that, so production never serves it.
export default function BagHarnessPage() {
  if (process.env.BAG_HARNESS !== "1") notFound();
  return (
    <Suspense>
      <BagHarness />
    </Suspense>
  );
}

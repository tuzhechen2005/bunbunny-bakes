import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { RackHarness } from "./RackHarness";

// Test/dev harness for the rope rack (e2e + screenshots) until the home composition mounts it.
// Not available in production unless RACK_HARNESS is set (read per request).
async function Gate() {
  await connection();
  if (process.env.NODE_ENV === "production" && !process.env.RACK_HARNESS) notFound();
  return <RackHarness />;
}

export default function DevRackPage() {
  return (
    <Suspense fallback={null}>
      <Gate />
    </Suspense>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { copy } from "@/copy";
import { ResetForm } from "./ResetForm";

export const metadata: Metadata = {
  title: `${copy.admin.auth.resetTitle} · ${copy.shopName}`,
};

// The token comes from ?token= and is read on the client (useSearchParams), so the
// page shell stays static; it is only ever sent in the POST body.
export default function AdminResetPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
      <h1 className="mb-6 text-center text-2xl font-semibold">{copy.admin.auth.resetTitle}</h1>
      <Suspense fallback={null}>
        <ResetForm />
      </Suspense>
    </main>
  );
}

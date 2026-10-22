import type { Metadata } from "next";
import { copy } from "@/copy";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: `${copy.admin.auth.loginTitle} · ${copy.shopName}`,
};

export default function AdminLoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
      <h1 className="mb-6 text-center text-2xl font-semibold">{copy.admin.auth.loginTitle}</h1>
      <LoginForm />
    </main>
  );
}

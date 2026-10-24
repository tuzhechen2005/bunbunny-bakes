import { NotFoundMessage } from "@/components/order/NotFoundMessage";

// Customer pages are fixed light (D74): top bar, the logo, one quiet line, a way home.
export default function NotFound() {
  return (
    <main className="flex min-h-svh w-full flex-1 flex-col bg-c-paper">
      <NotFoundMessage />
    </main>
  );
}

import { NotFoundMessage } from "@/components/order/NotFoundMessage";

// Explicit light colours: globals.css turns body dark under prefers-color-scheme: dark,
// and WeChat's iOS WebView follows the system setting.
export default function NotFound() {
  return (
    <main className="flex min-h-full w-full flex-1 flex-col bg-neutral-50 text-neutral-900">
      <div className="mx-auto w-full max-w-md">
        <NotFoundMessage />
      </div>
    </main>
  );
}

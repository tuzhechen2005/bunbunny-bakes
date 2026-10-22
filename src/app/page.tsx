import { copy } from "@/copy";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-bold">{copy.shopName}</h1>
      <p className="text-lg">{copy.home.orderingClosed}</p>
    </main>
  );
}

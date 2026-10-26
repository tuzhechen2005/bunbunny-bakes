import { connection } from "next/server";
import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/brand/Logo";
import { HomePage } from "@/components/customer/HomePage";
import { OrdersIcon } from "@/components/customer/rack/icons";
import { copy } from "@/copy";
import type { Menu } from "@/lib/api";
import { getInitialMenu } from "@/server/menuCache";
import "@/components/customer/rack/home.css";

const t = copy.customer.home;
const b = copy.customer.brand;

// The static shell (header, slogan) is prerendered; the menu is read on the server at request time
// (cached for about a minute, src/server/menuCache.ts) and streamed in with the first rope photo
// preloaded, so the rope is there at first paint (D91). The page still refetches /api/menu on mount,
// so a stale copy is corrected at once.
export default function Home() {
  return (
    <Suspense fallback={<HomeShell />}>
      <HomeWithMenu />
    </Suspense>
  );
}

async function HomeWithMenu() {
  await connection(); // request time only: nothing is read from the database while building
  // The server menu carries `images` and `field` (shared contract of the multi-photo / colour work); the
  // cast only bridges the two Menu types until both sides declare the same shape.
  return <HomePage initialMenu={(await getInitialMenu()) as Menu | null} />;
}

/**
 * What is on screen until the streamed page replaces it: the same header and slogan as the hero.
 * It carries no data-testid and no bag bar, so the (briefly hidden) streamed page is the only
 * element with those test ids and tests never see two of them.
 */
function HomeShell() {
  return (
    <div className="hm-page">
      <div className="hm-app">
        <section className="hm-hero">
          <header className="hm-hdr">
            <div className="hm-wm" role="img" aria-label={b.brandName}>
              <Logo />
              <span aria-hidden="true">{b.wordmark}</span>
            </div>
            <div className="hm-hr">
              <Link href="/orders" className="hm-orders" aria-label={t.myOrdersLabel}>
                <OrdersIcon />
                <span aria-hidden="true">{t.myOrdersEntry}</span>
              </Link>
            </div>
          </header>
          <p className="hm-slogan" role="presentation">
            {b.slogan}
          </p>
          <p className="hm-sub">{b.subLine}</p>
          <div className="hm-state" aria-hidden="true">
            <Logo className="h-14 w-auto opacity-40" />
          </div>
        </section>
      </div>
    </div>
  );
}

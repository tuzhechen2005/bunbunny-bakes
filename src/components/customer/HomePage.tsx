"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Logo } from "@/components/brand/Logo";
import { copy } from "@/copy";
import { formatCents } from "@/domain/pricing";
import type { Menu, MenuProduct } from "@/lib/api";
import { cart, useCart } from "@/lib/cart";
import { applyField, productField } from "@/lib/field";
import { flyToBag } from "@/lib/flyToBag";
import { pushOverlay } from "@/lib/overlayHistory";
import { useMotionPrefs } from "@/lib/motion/react";
import { BagBar } from "./bag/BagBar";
import { FlyLayer } from "./bag/FlyLayer";
import { fill, safeLineTotal } from "./format";
import { ProductCard } from "./ProductCard";
import { Detail, type DetailHandle } from "./rack/Detail";
import { NameSwap } from "./rack/NameSwap";
import { focusQuietly } from "./rack/focus";
import { Rack, type OpenVia, type RackHandle } from "./rack/Rack";
import { RollingText } from "./rack/RollingText";
import { OrdersIcon } from "./rack/icons";
import { SiteFooter } from "./SiteFooter";
import { useMenu } from "./useMenu";
import "./rack/home.css";

const t = copy.customer.home;
const b = copy.customer.brand;

/** Spin takes 0.64 s; the detail opens at about 0.54 s (FRONTEND.md 4.1). */
const SPIN_OPEN_MS = 540;
const HINT_KEY = "bb_tryme_done";
/** The page colour (layout.tsx `viewport.themeColor`): the browser chrome outside the home page. */
const THEME_COLOR = "#ffffff";

type Phase = "home" | "spin" | "detail" | "closing";

const noopSubscribe = () => () => {};
const readHintServer = () => false;

function readHintDone(): boolean {
  try {
    return window.sessionStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
}

/** Changes when the products on the rope change (ids or order), not when only a price or a status does. */
const productsKey = (m: Menu | null) => (m ? m.products.map((p) => p.id).join(",") : "");

/** `initialMenu`: what the server rendered the page with (src/app/page.tsx); null while it is not known. */
export function HomePage({ initialMenu = null }: { initialMenu?: Menu | null }) {
  const router = useRouter();
  const { status, menu: fetched, reload } = useMenu(initialMenu);
  const items = useCart();
  const { reduced } = useMotionPrefs();

  const phaseRef = useRef<Phase>("home");
  const [phase, setPhaseState] = useState<Phase>("home");
  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  // The menu on screen. A refetch that changes the products (other ids or order) rebuilds the rope, so it
  // is held while a bread is taken down or spinning and applied when the page is back home. The bread that
  // is shown stays shown (found by id in the new menu, else the first), and the rebuilt rope starts there
  // without playing the entrance again.
  const [menu, setMenu] = useState<Menu | null>(fetched);
  const [skipEntrance, setSkipEntrance] = useState(false);
  const [nav, setNav] = useState<{ i: number; dir: 1 | -1 }>({ i: 0, dir: 1 });
  if (fetched !== menu && (phase === "home" || fetched === null || menu === null)) {
    const shownId = menu?.products[Math.min(nav.i, Math.max(0, menu.products.length - 1))]?.id;
    if (productsKey(fetched) !== productsKey(menu)) {
      const hadRope = (menu?.products.length ?? 0) > 0 && (fetched?.products.length ?? 0) > 0;
      setSkipEntrance(hadRope);
      const at = fetched?.products.findIndex((p) => p.id === shownId) ?? -1;
      setNav({ i: Math.max(0, at), dir: 1 });
    }
    setMenu(fetched);
  }

  const products: readonly MenuProduct[] = menu?.products ?? [];
  const maxQty = menu?.maxQtyPerItem ?? 0;
  const byId = new Map<string, MenuProduct>(products.map((p) => [p.id, p]));
  const known = items.filter((i) => byId.has(i.productId));
  const count = known.reduce((sum, i) => sum + i.qty, 0);
  const subtotal = known.reduce((sum, i) => sum + safeLineTotal(i.qty, byId.get(i.productId)!), 0);
  const qtyOf = (id: string) => items.find((i) => i.productId === id)?.qty ?? 0;

  const productsRef = useRef<readonly MenuProduct[]>(products);
  useEffect(() => {
    productsRef.current = products;
  });

  // ---- which bread is on the rope, the colour follows ----
  const idx = Math.min(nav.i, Math.max(0, products.length - 1));
  const current: MenuProduct | undefined = products[idx];
  const onRopeIndex = useCallback((i: number) => {
    setNav((s) => (s.i === i ? s : { i, dir: i > s.i ? 1 : -1 }));
  }, []);
  // The bread's own colours (D95); a menu payload without them falls back to the old cycle by position.
  const fieldKey = current ? `${current.field?.bg}|${current.field?.ink}|${current.field?.ink2}` : "";
  useEffect(() => {
    applyField(productField(productsRef.current[idx] ?? {}, idx));
  }, [idx, fieldKey]);
  useEffect(() => {
    // Browser chrome (Safari / Android) takes the bread colour too.
    const f = productField(productsRef.current[idx] ?? {}, idx).field;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = f;
  }, [idx, fieldKey]);
  useEffect(() => {
    // The overscroll area behind the page follows the bread too (globals.css `html.field-bg`), and
    // both it and the browser chrome go back to the page colours when the home page unmounts.
    const root = document.documentElement;
    root.classList.add("field-bg");
    return () => {
      root.classList.remove("field-bg");
      const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      if (meta) meta.content = THEME_COLOR;
    };
  }, []);

  // ---- take down / hang back ----
  const heroRef = useRef<HTMLElement>(null);
  const rackRef = useRef<RackHandle>(null);
  const detailRef = useRef<DetailHandle>(null);
  const [detail, setDetail] = useState<{
    index: number;
    from: { left: number; top: number; width: number };
    via: OpenVia;
  } | null>(null);
  const curRef = useRef(0);
  /** Where the detail came from: a rope card, or a grid tile (the photo flies back to it). */
  const origin = useRef<{ tile: HTMLElement | null; via: OpenVia }>({ tile: null, via: "pointer" });
  /** Steps the history entry of the open detail back (Back closes the detail first, D90). */
  const leaveHistory = useRef<(() => void) | null>(null);
  const hangBackRef = useRef<() => void>(() => {});
  /** After hanging back, focus returns to where it came from once the page is no longer inert. */
  const refocus = useRef(false);
  useEffect(() => {
    if (phase === "home" && refocus.current) {
      refocus.current = false;
      const { tile, via } = origin.current;
      // After a touch nothing is focused (no ring); by key the opener gets its focus back.
      if (tile?.isConnected) focusQuietly(tile, via === "key");
      else if (via === "key") rackRef.current?.focus(true);
      else rackRef.current?.focus(false);
    }
  }, [phase]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // The server render and hydration see "not done yet"; the stored flag applies right after.
  const hintStored = useSyncExternalStore(noopSubscribe, readHintDone, readHintServer);
  const [hintShown, setHintOff] = useState(false);
  const hintOff = hintStored || hintShown;
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const markHintDone = useCallback(() => {
    setHintOff(true);
    try {
      window.sessionStorage.setItem(HINT_KEY, "1");
    } catch {
      /* the hint just shows again next visit */
    }
  }, []);

  const openDetail = useCallback(
    (i: number, via: OpenVia, tile: { rect: DOMRect; el: HTMLElement } | null = null) => {
      const rack = rackRef.current;
      if (tile) rack?.jumpTo(i);
      const hr = tile ? tile.rect : rack?.hangRect(i);
      if (!rack || !hr) {
        setPhase("home");
        return;
      }
      rack.setTaken(i, true);
      curRef.current = i;
      origin.current = { tile: tile?.el ?? null, via };
      setDetail({ index: i, from: { left: hr.left, top: hr.top, width: hr.width }, via });
      leaveHistory.current = pushOverlay(() => hangBackRef.current());
      setPhase("detail");
    },
    [setPhase],
  );

  /** A tap on a grid photo: the detail grows out of the tile, no spin (FRONTEND.md 4.1 item 5). */
  const openFromTile = useCallback(
    (i: number, rect: DOMRect, el: HTMLElement, via: OpenVia) => {
      if (phaseRef.current !== "home") return;
      markHintDone();
      openDetail(i, via, { rect, el });
    },
    [markHintDone, openDetail],
  );

  const takeDown = useCallback(
    (i: number, via: OpenVia) => {
      if (phaseRef.current !== "home") return;
      markHintDone();
      setPhase("spin");
      rackRef.current?.spin(i);
      if (reduced) openDetail(i, via);
      else timers.current.push(setTimeout(() => openDetail(i, via), SPIN_OPEN_MS));
    },
    [markHintDone, openDetail, reduced, setPhase],
  );

  const hangBack = useCallback(async () => {
    if (phaseRef.current !== "detail") return;
    setPhase("closing");
    // Closing by button / pull / Esc steps the history entry back; by Back it is gone already.
    leaveHistory.current?.();
    leaveHistory.current = null;
    const cur = curRef.current;
    const rack = rackRef.current;
    rack?.jumpTo(cur);
    let to: DOMRect | null = rack?.faceRect(cur) ?? null;
    const fromTile = origin.current.tile !== null;
    if (fromTile) {
      // Back to the grid photo if it is on screen, otherwise the photo just fades away with the page.
      const id = productsRef.current[cur]?.id;
      const tile = [...document.querySelectorAll<HTMLElement>("[data-testid=product-card]")].find((e) => e.dataset.productId === id);
      const r = tile?.querySelector(".hm-ph-img")?.getBoundingClientRect();
      origin.current.tile = tile?.querySelector<HTMLElement>(".hm-tile-btn") ?? null;
      to = r && r.bottom > 0 && r.top < window.innerHeight ? r : null;
    }
    await detailRef.current?.close(to);
    setDetail(null);
    rack?.setTaken(cur, false);
    refocus.current = true;
    setPhase("home");
    if (!fromTile) rack?.landed(cur);
  }, [setPhase]);
  useEffect(() => {
    hangBackRef.current = () => void hangBack();
  }, [hangBack]);

  useEffect(() => {
    if (phase !== "detail") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void hangBack();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [phase, hangBack]);

  const onDetailIndex = useCallback((i: number) => {
    if (phaseRef.current !== "detail") return;
    const rack = rackRef.current;
    rack?.setTaken(curRef.current, false);
    curRef.current = i;
    rack?.setTaken(i, true);
    rack?.goTo(i);
    applyField(productField(productsRef.current[i] ?? {}, i));
  }, []);

  // ---- adding: only from the detail (D97) ----
  const addFromDetail = (p: MenuProduct, qty: number, from: DOMRect) => {
    const have = qtyOf(p.id);
    const next = Math.min(maxQty, have + qty);
    const added = next - have;
    if (p.status === "PAUSED" || added <= 0) return;
    cart.setQty(p.id, next, maxQty);
    flyToBag({ from, imageUrl: p.imageUrl, productId: p.id, count: added });
  };

  const orderingEnabled = menu?.orderingEnabled ?? false;
  const paused = current?.status === "PAUSED";
  const showHero = menu !== null && products.length > 0;

  return (
    <div className="hm-page" data-compact={phase === "detail" ? "" : undefined}>
      <div className="hm-app">
        <div inert={phase !== "home"}>
          <section ref={heroRef} className="hm-hero" data-testid="hero" data-phase={phase}>
            <header className="hm-hdr">
              <div className="hm-wm" role="img" aria-label={b.brandName}>
                <Logo />
                <span aria-hidden="true">{b.wordmark}</span>
              </div>
              <div className="hm-hr">
                {menu ? (
                  // Open: nothing to look at (D75), but still announced. Closed: a small status in the corner.
                  <span className={menu.orderingEnabled ? "hm-sr" : "hm-open"} data-testid="ordering-state">
                    <i aria-hidden="true" />
                    {menu.orderingEnabled ? copy.home.orderingOpen : copy.home.orderingClosed}
                  </span>
                ) : null}
                <Link href="/orders" className="hm-orders" data-testid="my-orders-link" aria-label={t.myOrdersLabel}>
                  <OrdersIcon />
                  <span aria-hidden="true">{t.myOrdersEntry}</span>
                </Link>
              </div>
            </header>
            <h1 className="hm-slogan">{b.slogan}</h1>
            <p className="hm-sub">{b.subLine}</p>
            {menu && !menu.orderingEnabled ? (
              <div className="hm-closed">
                <p>{t.orderingClosedHint}</p>
              </div>
            ) : null}

            {status === "loading" ? (
              <div className="hm-state" role="status">
                <Logo className="h-14 w-auto opacity-40" />
                <p>{t.loading}</p>
              </div>
            ) : null}
            {status === "error" ? (
              <div className="hm-state">
                <Logo className="h-14 w-auto opacity-40" />
                <p role="alert">{t.loadFailed}</p>
                <button type="button" onClick={reload}>
                  {t.retry}
                </button>
              </div>
            ) : null}
            {menu && products.length === 0 ? (
              <div className="hm-state">
                <Logo className="h-14 w-auto opacity-40" />
                <p>{t.emptyMenu}</p>
              </div>
            ) : null}

            {showHero && current ? (
              <>
                <Rack
                  // The rack measures and places its cards once per product count; a refetch with the
                  // same count but other products or order must start it again.
                  key={productsKey(menu)}
                  startIndex={idx}
                  skipEntrance={skipEntrance}
                  ref={rackRef}
                  products={products}
                  index={idx}
                  onIndexChange={onRopeIndex}
                  onOpen={takeDown}
                  hostRef={heroRef}
                  active={phase === "home"}
                  hintOff={hintOff}
                />
                <div className="hm-info" data-testid="current">
                  <h2 className="hm-name" data-testid="current-name">
                    <NameSwap text={current.name} dir={nav.dir} />
                  </h2>
                  <div className="hm-price">
                    <b className="hm-n">
                      <RollingText value={formatCents(current.unitPriceCents)} />
                    </b>
                    {paused ? (
                      <span className="hm-warn">{t.paused}</span>
                    ) : current.bundlePriceCents !== null ? (
                      <span>{fill(t.bundlePrice, { size: current.bundleSize, price: formatCents(current.bundlePriceCents) })}</span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="hm-viewp"
                    aria-label={fill(t.viewHeroNamed, { name: current.name })}
                    onClick={(e) => takeDown(idx, e.detail === 0 ? "key" : "pointer")}
                    data-testid="hero-view"
                  >
                    {t.viewHero}
                  </button>
                </div>
                <div className="hm-dots" aria-hidden="true">
                  {products.map((p, k) => (
                    <i key={p.id} className={k === idx ? "is-on" : ""} />
                  ))}
                </div>
              </>
            ) : null}
          </section>

          {menu && products.length > 0 ? (
            <section className="hm-list" aria-labelledby="hm-list-title">
              <h2 className="hm-sec-t" id="hm-list-title">
                {b.listTitle}
              </h2>
              <ul className="hm-grid">
                {products.map((p) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    onOpen={(rect, el, via) => openFromTile(products.indexOf(p), rect, el, via)}
                  />
                ))}
              </ul>
            </section>
          ) : null}
          {menu ? <SiteFooter ownerWechatId={menu.ownerWechatId} home /> : null}
        </div>
      </div>

      {detail ? (
        <Detail
          ref={detailRef}
          products={products}
          startIndex={detail.index}
          from={detail.from}
          maxQty={maxQty}
          inCart={qtyOf}
          onIndexChange={onDetailIndex}
          onClose={() => void hangBack()}
          onAdd={addFromDetail}
          via={detail.via}
        />
      ) : null}

      <BagBar
        products={products}
        maxQty={maxQty}
        cart={items}
        count={count}
        subtotalCents={subtotal}
        orderingEnabled={orderingEnabled}
        onIncrease={(id) => cart.increment(id, maxQty)}
        onDecrease={(id) => cart.decrement(id)}
        onCheckout={() => router.push("/checkout")}
        compact={phase === "detail"}
      />
      <FlyLayer />
    </div>
  );
}

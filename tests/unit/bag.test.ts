import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { arrowZoom } from "@/components/customer/bag/anim";
import {
  flightBegin,
  flightLand,
  pendingFlights,
  resetFlights,
  subscribeBegin,
  subscribeLand,
  type Landing,
} from "@/components/customer/bag/bagFlights";
import { BagSheet } from "@/components/customer/bag/BagSheet";
import { PaperBag } from "@/components/customer/bag/PaperBag";
import { RollText } from "@/components/customer/bag/RollText";
import { copy } from "@/copy";
import type { MenuProduct } from "@/lib/api";

const product = (over: Partial<MenuProduct> = {}): MenuProduct => ({
  id: "p1",
  name: "奶酥红豆包",
  description: null,
  imageUrl: "/img/p1.jpg",
  unitPriceCents: 249,
  bundleSize: 4,
  bundlePriceCents: 899,
  status: "ACTIVE",
  leadDays: 1,
  ...over,
});

const noop = () => {};
const sheetProps = (over: Record<string, unknown> = {}) => ({
  products: [product(), product({ id: "p2", name: "焦糖布蕾", imageUrl: null, unitPriceCents: 249, bundlePriceCents: null })],
  maxQty: 10,
  cart: [
    { productId: "p1", qty: 4 },
    { productId: "p2", qty: 1 },
  ],
  items: [
    { productId: "p1", imageUrl: "/img/p1.jpg", qty: 4 },
    { productId: "p2", imageUrl: null, qty: 1 },
  ],
  count: 5,
  subtotalCents: 1148,
  orderingEnabled: true,
  onIncrease: noop,
  onDecrease: noop,
  onCheckout: noop,
  onClose: noop,
  ...over,
});
const sheet = (over: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(BagSheet, sheetProps(over)));

describe("BagSheet", () => {
  it("is a labelled modal dialog with lines, prices and the subtotal", () => {
    const html = sheet();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain(`aria-label="${copy.customer.brand.bagName}"`);
    expect(html).toContain("奶酥红豆包");
    expect(html).toContain("焦糖布蕾");
    expect(html).toContain('aria-label="$8.99"'); // 4 for the bundle price
    expect(html).toContain('aria-label="$2.49"');
    expect(html).toContain('aria-label="$11.48"'); // subtotal
    expect(html).toContain('data-bag-target="sheet"');
  });

  it("checkout is enabled with bread in the bag and ordering open", () => {
    const html = sheet();
    const btn = html.match(/<button[^>]*data-testid="bag-checkout"[^>]*>/)![0];
    expect(btn).not.toContain('disabled=""');
    expect(html).toContain(copy.customer.home.goCheckout);
  });

  it("checkout is disabled and says so when ordering is closed", () => {
    const html = sheet({ orderingEnabled: false });
    const btn = html.match(/<button[^>]*data-testid="bag-checkout"[^>]*>/)![0];
    expect(btn).toContain('disabled=""');
    expect(html).toContain(copy.customer.home.checkoutClosed);
  });

  it("an empty bag shows the empty line and a disabled checkout", () => {
    const html = sheet({ cart: [], items: [], count: 0, subtotalCents: 0 });
    expect(html).toContain(copy.customer.brand.emptyBag);
    expect(html).not.toContain('data-testid="bag-line"');
    const btn = html.match(/<button[^>]*data-testid="bag-checkout"[^>]*>/)![0];
    expect(btn).toContain('disabled=""');
  });

  it("at the maximum the + is disabled and the hint shows; below it the + works", () => {
    const atMax = sheet({ maxQty: 4 });
    const inc = atMax.match(/<button[^>]*data-testid="bag-line-inc"[^>]*>/g)!;
    expect(inc[0]).toContain('disabled=""'); // p1 has 4
    expect(inc[1]).not.toContain('disabled=""'); // p2 has 1
    expect(atMax).toContain(copy.customer.home.maxReached);
    expect(sheet()).not.toContain(copy.customer.home.maxReached);
  });

  it("ignores cart lines whose product left the menu", () => {
    const html = sheet({ cart: [{ productId: "gone", qty: 2 }, { productId: "p1", qty: 1 }] });
    expect(html.match(/data-testid="bag-line"/g)).toHaveLength(1);
  });

  it("controls are real buttons with labels (44 px class) and the close button is labelled", () => {
    const html = sheet();
    expect(html).toContain(`aria-label="${copy.customer.brand.closeBag}"`);
    expect(html).toContain(`aria-label="${copy.customer.home.decrease}"`);
    expect(html).toContain(`aria-label="${copy.customer.home.increase}"`);
    expect(html).toContain("size-11");
  });
});

describe("PaperBag", () => {
  const render = (props: Record<string, unknown> = {}) =>
    renderToStaticMarkup(createElement(PaperBag, { width: 130, items: [], ...props }));

  it("prints the logo and wordmark on the flap and has the window", () => {
    const html = render();
    expect(html).toContain("/brand/logo.webp");
    expect(html).toContain(copy.customer.brand.wordmark);
    expect(html).toContain("data-pb-window");
    expect(html).toContain("--bw:130px");
    expect(html).not.toContain("pb-sm");
    expect(render({ width: 52 })).toContain("pb-sm");
  });

  it("renders folded on mount when folded is true, open otherwise", () => {
    expect(render({ folded: true })).toContain("rotateX(-180deg)");
    expect(render({ folded: false })).not.toContain("rotateX");
  });

  it("puts the imprint above the flap and marks the shakeable bag", () => {
    const html = render({ imprint: createElement("svg", { "data-stamp": "x" }), shakeable: true });
    expect(html).toContain('class="pb-imprint"');
    expect(html).toContain('data-stamp="x"');
    expect(html.indexOf("pb-imprint")).toBeGreaterThan(html.indexOf("pb-top"));
    expect(html).toContain("pb-shakeable");
    expect(render()).not.toContain("pb-imprint");
  });
});

describe("RollText", () => {
  it("holds exactly the current text and announces it as a whole", () => {
    const html = renderToStaticMarkup(createElement(RollText, { value: "$12.99", testId: "x" }));
    expect(html.replace(/<[^>]+>/g, "")).toBe("$12.99");
    expect(html).toContain('aria-label="$12.99"');
    expect(html).toContain('role="img"');
  });
});

describe("flight bookkeeping", () => {
  afterEach(() => resetFlights());

  const landing = (over: Partial<Landing> = {}): Landing => ({
    productId: "a",
    count: 1,
    xFrac: 0.5,
    target: "bar",
    first: true,
    ...over,
  });

  it("counts breads in the air per product and clears them as they land", () => {
    flightBegin({ productId: "a", count: 3 });
    flightBegin({ productId: "b", count: 1 });
    expect(pendingFlights().get("a")).toBe(3);
    flightLand(landing({ count: 1 }));
    flightLand(landing({ count: 2, first: false }));
    expect(pendingFlights().has("a")).toBe(false);
    expect(pendingFlights().get("b")).toBe(1);
    flightLand(landing({ productId: "b" }));
    expect(pendingFlights().size).toBe(0);
  });

  it("bags receive the landing before the pending count drops (nothing is counted twice)", () => {
    flightBegin({ productId: "a", count: 2 });
    const seen: number[] = [];
    const off = subscribeLand(() => seen.push(pendingFlights().get("a") ?? 0));
    flightLand(landing({ count: 2 }));
    off();
    expect(seen).toEqual([2]);
    expect(pendingFlights().get("a")).toBeUndefined();
  });

  it("announces the beginning of an add with its full count", () => {
    const got: unknown[] = [];
    const off = subscribeBegin((b) => got.push(b));
    flightBegin({ productId: "a", count: 4 });
    off();
    flightBegin({ productId: "a", count: 1 });
    expect(got).toEqual([{ productId: "a", count: 4 }]);
  });
});

describe("arrowZoom", () => {
  it("resolves at once when motion is reduced or there is no arrow", async () => {
    const root = { querySelector: () => ({ animate: () => null }) } as unknown as Element;
    await expect(arrowZoom(root, true)).resolves.toBeUndefined();
    await expect(arrowZoom(null, false)).resolves.toBeUndefined();
    const bare = { querySelector: () => null } as unknown as Element;
    await expect(arrowZoom(bare, false)).resolves.toBeUndefined();
  });

  it("runs out to the right, then back in from the left", async () => {
    const calls: unknown[][] = [];
    const svg = {
      animate: (kf: unknown[], opts: unknown) => {
        calls.push([kf, opts]);
        return { finished: Promise.resolve() };
      },
    };
    const root = { querySelector: () => svg } as unknown as Element;
    await arrowZoom(root, false);
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[0][0])).toContain("translateX(170%)");
    expect(JSON.stringify(calls[1][0])).toContain("translateX(-170%)");
  });
});

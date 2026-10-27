import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BunnyMark } from "@/components/brand/BunnyMark";
import { BagBar } from "@/components/customer/bag/BagBar";
import { Rack } from "@/components/customer/rack/Rack";
import { Logo } from "@/components/brand/Logo";
import { copy } from "@/copy";
import type { MenuProduct } from "@/lib/api";
import { flyToBag } from "@/lib/flyToBag";
import { haptic } from "@/lib/motion/react";

const product = (over: Partial<MenuProduct> = {}): MenuProduct => ({
  id: "p1",
  name: "奶酥红豆包",
  description: null,
  imageUrl: null,
  images: [],
  field: { bg: "#EFE7DA", ink: "#3C2D1E", ink2: "#5C4B3A" },
  unitPriceCents: 249,
  bundleSize: 4,
  bundlePriceCents: 899,
  status: "ACTIVE",
  leadDays: 1,
  pickupWeekdays: [],
  ...over,
});

describe("stubs and brand components render", () => {
  it("BunnyMark is decorative without a title and labelled with one", () => {
    expect(renderToStaticMarkup(createElement(BunnyMark, {}))).toContain('aria-hidden="true"');
    const labelled = renderToStaticMarkup(createElement(BunnyMark, { title: "店标", size: 40, color: "red" }));
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain("<title>店标</title>");
    expect(labelled).not.toContain("aria-hidden");
    expect(labelled).toContain('width="40"');
  });

  it("Rack lists the products as options of one listbox and marks paused ones", () => {
    const html = renderToStaticMarkup(
      createElement(Rack, {
        products: [product(), product({ id: "p2", name: "焦糖布蕾", status: "PAUSED" })],
        index: 0,
        onIndexChange: () => {},
        onOpen: () => {},
        hostRef: { current: null },
        active: true,
        hintOff: false,
      }),
    );
    expect(html).toContain('aria-label="奶酥红豆包"');
    expect(html).toContain('aria-label="焦糖布蕾"');
    expect(html).toContain(copy.customer.brand.rackLabel);
    expect(html).toContain(copy.customer.brand.tryMe);
    expect(html.match(/role="option"/g)).toHaveLength(2);
    expect(html.match(/is-paused/g)).toHaveLength(1);
  });

  // The disabled checkout (ordering closed or empty bag) lives in the bag sheet now: see
  // tests/unit/bag.test.ts. The bar itself always opens the sheet.
  it("BagBar shows the count and amount and stays tappable when ordering is closed", () => {
    const props = {
      products: [product()],
      maxQty: 10,
      cart: [{ productId: "p1", qty: 3 }],
      count: 3,
      subtotalCents: 899,
      onIncrease: () => {},
      onDecrease: () => {},
      onCheckout: () => {},
    };
    const open = renderToStaticMarkup(createElement(BagBar, { ...props, orderingEnabled: true }));
    expect(open).toContain("$8.99");
    expect(open).not.toContain("disabled=\"\"");
    const closed = renderToStaticMarkup(createElement(BagBar, { ...props, orderingEnabled: false }));
    expect(closed).toContain("$8.99");
    expect(closed).not.toContain("disabled=\"\"");
  });

  it("Logo is the brand image, decorative unless labelled", () => {
    expect(renderToStaticMarkup(createElement(Logo, {}))).toContain('alt=""');
    expect(renderToStaticMarkup(createElement(Logo, { label: "兔的大面包" }))).toContain('alt="兔的大面包"');
  });

  it("brand copy matches FRONTEND.md section 3", () => {
    const b = copy.customer.brand;
    expect(b.slogan).toBe("今日出炉，限量手作。");
    expect(b.subLine).toBe("每轮现做，当天出炉！");
    expect(b.listTitle).toBe("全部面包");
    expect(b.bagName).toBe("你的纸袋");
    expect(b.emptyBag).toBe("纸袋还是空的");
    expect(b.receiptLast).toBe("面包已经在排队发酵啦！");
    expect(b.wordmark).toBe("的大面包");
    expect(b.tryMe).toBe("点击试试！");
  });
});

describe("side-effect helpers never throw", () => {
  it("haptic is a no-op without navigator.vibrate", () => {
    expect(() => haptic()).not.toThrow();
  });

  it("flyToBag is a no-op during SSR", () => {
    expect(() => flyToBag({ from: {} as DOMRect, imageUrl: null, productId: "p1" })).not.toThrow();
  });
});

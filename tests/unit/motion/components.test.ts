import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BunnyMark } from "@/components/brand/BunnyMark";
import { BagBar } from "@/components/customer/bag/BagBar";
import { Rack } from "@/components/customer/rack/Rack";
import { CountUp } from "@/components/reactbits/CountUp";
import { ShinyText } from "@/components/reactbits/ShinyText";
import { copy } from "@/copy";
import type { MenuProduct } from "@/lib/api";
import { flyToBag } from "@/lib/flyToBag";
import { haptic } from "@/lib/motion/react";

const product = (over: Partial<MenuProduct> = {}): MenuProduct => ({
  id: "p1",
  name: "奶酥红豆包",
  description: null,
  imageUrl: null,
  unitPriceCents: 249,
  bundleSize: 4,
  bundlePriceCents: 899,
  status: "ACTIVE",
  leadDays: 1,
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

  it("Rack lists products on the rope and marks paused ones", () => {
    const html = renderToStaticMarkup(
      createElement(Rack, {
        products: [product(), product({ id: "p2", name: "焦糖布蕾", status: "PAUSED" })],
        maxQty: 10,
        cart: [{ productId: "p1", qty: 1 }],
        onAdd: () => {},
      }),
    );
    expect(html).toContain("奶酥红豆包");
    expect(html).toContain(copy.customer.brand.rackTitle);
    expect(html).toContain('data-paused="true"');
    expect(html).toContain(copy.customer.home.paused);
  });

  it("BagBar shows the count and amount", () => {
    const html = renderToStaticMarkup(
      createElement(BagBar, { count: 3, subtotalCents: 899, disabled: false, onCheckout: () => {} }),
    );
    expect(html).toContain("已选 3 件");
    expect(html).toContain("$8.99");
    expect(html).toContain(copy.customer.home.goCheckout);
  });

  it("CountUp and ShinyText render their final text on the server", () => {
    expect(
      renderToStaticMarkup(createElement(CountUp, { value: 1250, format: (n: number) => `$${n / 100}` })),
    ).toContain("$12.5");
    expect(renderToStaticMarkup(createElement(ShinyText, { text: "今日出炉" }))).toContain("今日出炉");
  });

  it("brand copy matches FRONTEND.md section 3", () => {
    expect(copy.customer.brand).toMatchObject({
      slogan: "今日出炉，限量手作。",
      subLine: "每轮现做，当天出炉！",
      rackTitle: "今日出炉",
      listTitle: "全部面包",
      bagName: "你的纸袋",
      addToBag: "放进纸袋",
      emptyBag: "纸袋还是空的，去绳子上挑一个吧。",
      receiptLast: "面包已经在排队发酵啦！",
    });
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

import { copy } from "@/copy";

const FONT_SANS = "var(--font-display), 'PingFang SC', sans-serif";
const FONT_NUM = "var(--font-num), Georgia, serif";

/**
 * The order seal (prototype stampSVG): a ring with the ring text, a solid red disc with the
 * stamp word and the order number knocked out, and an ink-texture filter. Red comes from
 * `currentColor` (the bag's imprint layer sets it to the red token).
 */
export function StampSvg({ orderNo }: { orderNo: string }) {
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <defs>
        <filter id="ord-ink" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="8" result="t" />
          <feColorMatrix in="t" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.25 1.55" result="m" />
          <feComposite in="SourceGraphic" in2="m" operator="in" result="c" />
          <feTurbulence type="fractalNoise" baseFrequency=".04" numOctaves="2" seed="3" result="w" />
          <feDisplacementMap in="c" in2="w" scale="3.5" />
        </filter>
        <path id="ord-ring" d="M100 100m-77 0a77 77 0 1 1 154 0a77 77 0 1 1-154 0" />
      </defs>
      <g filter="url(#ord-ink)">
        <circle cx="100" cy="100" r="96" fill="none" stroke="currentColor" strokeWidth="6" />
        <circle cx="100" cy="100" r="88" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <text fill="currentColor" fontWeight="900" fontSize="15.5" letterSpacing="4.4" style={{ fontFamily: FONT_SANS }}>
          <textPath href="#ord-ring">{copy.customer.brand.stampRing}</textPath>
        </text>
        <circle cx="100" cy="100" r="62" fill="currentColor" />
        <path d="M48 112h104" strokeWidth="1.4" style={{ stroke: "var(--c-paper)" }} />
        <text
          x="100"
          y="102"
          textAnchor="middle"
          fontWeight="900"
          fontSize="40"
          letterSpacing="1"
          style={{ fontFamily: FONT_SANS, fill: "var(--c-paper)" }}
        >
          {copy.customer.order.stamp}
        </text>
        <text
          x="100"
          y="134"
          textAnchor="middle"
          fontWeight="700"
          fontSize="17"
          letterSpacing="1"
          style={{ fontFamily: FONT_NUM, fill: "var(--c-paper)" }}
        >
          {orderNo}
        </text>
      </g>
    </svg>
  );
}

import { useId } from "react";
import { copy } from "@/copy";

/**
 * The 新品 seal on a new product's photo (N1): the order seal's language — double ring, solid disc,
 * knocked-out word, ink texture — small and tilted in the corner. Red is `currentColor`.
 */
export function NewStamp({ className = "" }: { className?: string }) {
  const ink = `${useId().replace(/:/g, "")}-ink`;
  return (
    <svg viewBox="0 0 100 100" className={`hm-new-stamp ${className}`} aria-hidden="true" focusable="false" data-testid="new-stamp">
      <defs>
        <filter id={ink} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="5" result="t" />
          <feColorMatrix in="t" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.2 1.6" result="m" />
          <feComposite in="SourceGraphic" in2="m" operator="in" />
        </filter>
      </defs>
      <g filter={`url(#${ink})`}>
        <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" strokeWidth="3.5" />
        <circle cx="50" cy="50" r="41" fill="currentColor" />
        <text x="50" y="59" textAnchor="middle" fontWeight="900" fontSize="25" letterSpacing="1"
          style={{ fontFamily: "var(--font-display), 'PingFang SC', sans-serif", fill: "var(--c-paper)" }}>
          {copy.customer.home.newBadge}
        </text>
      </g>
    </svg>
  );
}

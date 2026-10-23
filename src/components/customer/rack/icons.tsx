// Small stroke icons of the home page (prototype `IC`). Decorative: the button carries the label.
import type { SVGProps } from "react";

function Svg({ children, strokeWidth = 2.2, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const PlusIcon = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const MinusIcon = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
);
export const DownIcon = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
);
export const LeftIcon = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M15 6l-6 6 6 6" />
  </Svg>
);
export const RightIcon = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);

/** A small receipt: the "my orders" entry in the home header. */
export const OrdersIcon = (p: SVGProps<SVGSVGElement>) => (
  <Svg strokeWidth={2} {...p}>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
    <path d="M9.5 8.5h5M9.5 12.5h5" />
  </Svg>
);

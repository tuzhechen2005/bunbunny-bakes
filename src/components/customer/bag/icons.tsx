import type { SVGProps } from "react";

function Svg({ d, ...rest }: { d: string } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={d} />
    </svg>
  );
}

export const PlusIcon = (p: SVGProps<SVGSVGElement>) => <Svg d="M12 5v14M5 12h14" {...p} />;
export const MinusIcon = (p: SVGProps<SVGSVGElement>) => <Svg d="M5 12h14" {...p} />;
export const CloseIcon = (p: SVGProps<SVGSVGElement>) => <Svg d="M6 6l12 12M18 6 6 18" {...p} />;
/** The arrow that "zooms" out to the right on tap (see arrowZoom in anim.ts). */
export const ArrowIcon = (p: SVGProps<SVGSVGElement>) => <Svg d="M5 12h14M13 6l6 6-6 6" data-zoom-arrow="" {...p} />;

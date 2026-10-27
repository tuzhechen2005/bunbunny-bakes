import type { SVGProps } from "react";

/** Line-drawn bunny head (ink, no fill): two long ears, a round face, two dots for eyes. */
export function BunnyIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...p}
    >
      <path d="M9.5 10.5C7.8 8 7.4 4.6 8.4 3c1.2-.3 2.4 2.4 2.8 5.2" />
      <path d="M14.5 10.5c1.7-2.5 2.1-5.9 1.1-7.5-1.2-.3-2.4 2.4-2.8 5.2" />
      <path d="M12 8.6c-3.6 0-6 2.2-6 5.4 0 3.2 2.5 5.6 6 5.6s6-2.4 6-5.6c0-3.2-2.4-5.4-6-5.4Z" />
      <path d="M9.6 14h.01M14.4 14h.01" strokeWidth={2.4} />
    </svg>
  );
}

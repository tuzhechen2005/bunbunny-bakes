/** Kraft paper bag (FRONTEND.md 4.1 item 5): folded top, twisted-paper handle, one soft crease. Colours via tokens. */
export function PaperBagIcon({ size = 40 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      data-testid="paper-bag-icon"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* handle */}
      <path d="M17 13C17 5 31 5 31 13" fill="none" stroke="var(--caramel-strong)" strokeWidth={2} />
      {/* body */}
      <path d="M8 13H40L42 43C42 44.5 41 45 40 45H8C7 45 6 44.5 6 43Z" fill="var(--kraft)" stroke="var(--ink)" strokeWidth={1.6} />
      {/* folded top band */}
      <path d="M7.4 13H40.6L40.9 19H7.1Z" fill="var(--caramel-tint)" stroke="var(--ink)" strokeWidth={1.2} opacity={0.9} />
      {/* side crease */}
      <path d="M31 19L33 45" fill="none" stroke="var(--ink)" strokeWidth={1} opacity={0.25} />
    </svg>
  );
}

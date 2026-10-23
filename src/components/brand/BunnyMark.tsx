export interface BunnyMarkProps {
  /** Rendered width/height in px. Default 28. */
  size?: number;
  /** Stroke colour; defaults to the current text colour (`currentColor`). */
  color?: string;
  /** Accessible name. Without it the mark is decorative (`aria-hidden`). */
  title?: string;
}

/**
 * L3 "bread bunny" (D65): a slice of toast with two bunny ears, one colour, thin line.
 * Used only next to the shop name, in the empty bag and on the order receipt (FRONTEND.md section 2).
 */
export function BunnyMark({ size = 28, color = "currentColor", title }: BunnyMarkProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      data-testid="bunny-mark"
    >
      {title ? <title>{title}</title> : null}
      {/* ears */}
      <path d="M20 25C15 13 18 4 24 4C29 4 30 14 29 25" />
      <path d="M44 25C49 13 46 4 40 4C35 4 34 14 35 25" />
      {/* toast: wide shoulders, straight sides, rounded base */}
      <path d="M14 31C14 26 18 25 22 25H42C46 25 50 26 50 31C50 34 48 35 48 37V54C48 57 46 60 43 60H21C18 60 16 57 16 54V37C16 35 14 34 14 31Z" />
      {/* crust line */}
      <path d="M23 36C23 33 25 32 28 32" opacity={0.55} />
    </svg>
  );
}

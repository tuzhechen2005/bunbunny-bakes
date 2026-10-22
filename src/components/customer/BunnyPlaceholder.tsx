/** Shared placeholder for products without a photo: a simple bunny face. */
export function BunnyPlaceholder({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      aria-hidden="true"
      focusable="false"
      data-testid="bunny-placeholder"
    >
      <rect width="100" height="100" fill="var(--soft)" />
      <ellipse cx="38" cy="30" rx="8" ry="20" fill="var(--card)" stroke="var(--border)" strokeWidth="2" />
      <ellipse cx="62" cy="30" rx="8" ry="20" fill="var(--card)" stroke="var(--border)" strokeWidth="2" />
      <ellipse cx="38" cy="31" rx="3.5" ry="13" fill="#f3c9c0" />
      <ellipse cx="62" cy="31" rx="3.5" ry="13" fill="#f3c9c0" />
      <circle cx="50" cy="62" r="24" fill="var(--card)" stroke="var(--border)" strokeWidth="2" />
      <circle cx="42" cy="58" r="2.6" fill="var(--foreground)" />
      <circle cx="58" cy="58" r="2.6" fill="var(--foreground)" />
      <ellipse cx="50" cy="65" rx="3" ry="2.2" fill="#e8a596" />
      <circle cx="36" cy="68" r="4" fill="#f3c9c0" opacity="0.7" />
      <circle cx="64" cy="68" r="4" fill="#f3c9c0" opacity="0.7" />
    </svg>
  );
}

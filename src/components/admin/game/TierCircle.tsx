/** A tier as the game draws it: a circle in the tier colour with the (transparent) image inside. */
export function TierCircle({
  bg,
  ink,
  initial,
  src,
  alt,
  size = 64,
  testId,
}: Readonly<{ bg: string; ink?: string; initial?: string; src: string | null; alt: string; size?: number; testId?: string }>) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-line"
      style={{ width: size, height: size, backgroundColor: bg }}
      data-testid={testId}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="h-full w-full object-contain" draggable={false} />
      ) : initial ? (
        <span className="font-display text-2xl" style={{ color: ink }} aria-hidden="true">
          {[...initial][0]}
        </span>
      ) : null}
    </span>
  );
}

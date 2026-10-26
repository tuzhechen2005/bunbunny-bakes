/** A tier as the game draws it: a circle in the tier colour with the (transparent) image inside. */
export function TierCircle({
  bg,
  src,
  alt,
  size = 64,
  testId,
}: Readonly<{ bg: string; src: string | null; alt: string; size?: number; testId?: string }>) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-line"
      style={{ width: size, height: size, backgroundColor: bg }}
      data-testid={testId}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="h-full w-full object-contain" draggable={false} />
      ) : null}
    </span>
  );
}

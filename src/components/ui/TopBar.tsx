import Link from "next/link";
import { focusRing } from "./focus";

export interface TopBarProps {
  /** Where the chevron goes (a real link, so it also works without JavaScript). */
  backHref: string;
  /** Accessible name of the chevron. */
  backLabel: string;
  /** Shown next to the chevron. Omit on pages whose own heading says it (the order page, 404). */
  title?: string;
  /** "h1" when the title is the page heading, otherwise a plain line. */
  titleAs?: "h1" | "p";
  /** Optional element on the right (kept small: the bar is 56 px). */
  right?: React.ReactNode;
}

/** 56 px bar of the customer sub-pages: a 44 px chevron back and the page title. */
export function TopBar({ backHref, backLabel, title, titleAs = "p", right }: TopBarProps) {
  const Title = titleAs;
  return (
    <div className="flex h-14 shrink-0 items-center gap-1 px-2.5" data-testid="top-bar">
      <Link
        href={backHref}
        aria-label={backLabel}
        className={`grid size-11 shrink-0 place-items-center rounded-full text-c-ink ${focusRing}`}
        data-testid="top-bar-back"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M15 6l-6 6 6 6" />
        </svg>
      </Link>
      {title ? (
        <Title className="font-display m-0 min-w-0 flex-1 truncate text-[19px] leading-none tracking-[-0.02em] text-c-ink">
          {title}
        </Title>
      ) : (
        <span className="flex-1" />
      )}
      {right}
    </div>
  );
}

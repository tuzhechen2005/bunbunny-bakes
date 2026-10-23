import { useId } from "react";

/** Wooden clothes-peg with a steel spring (prototype `.peg`). Colours: --peg-* in home.css. */
export function Peg() {
  const id = useId();
  const grad = `peg-${id.replace(/:/g, "")}`;
  return (
    <span className="hm-peg" aria-hidden="true">
      <svg viewBox="0 0 16 38" focusable="false">
        <defs>
          <linearGradient id={grad} x1="0" x2="1">
            <stop offset="0" style={{ stopColor: "var(--peg-a)" }} />
            <stop offset=".5" style={{ stopColor: "var(--peg-b)" }} />
            <stop offset="1" style={{ stopColor: "var(--peg-c)" }} />
          </linearGradient>
        </defs>
        <path d="M1.5 2.5Q1.5 1 3 1h3.2v35.4Q4 37.5 3 36.2 1.5 30 1.5 22z" fill={`url(#${grad})`} />
        <path d="M14.5 2.5q0-1.5-1.5-1.5H9.8v35.4q2.2 1.1 3.2-.2 1.5-6.2 1.5-14.2z" fill={`url(#${grad})`} />
        <path d="M6.2 1v35.4M9.8 1v35.4" strokeWidth=".6" opacity=".6" style={{ stroke: "var(--peg-line)" }} />
        <rect x=".6" y="12.5" width="14.8" height="4.2" rx="1.2" style={{ fill: "var(--peg-steel)" }} />
        <rect x=".6" y="12.9" width="14.8" height="1.2" rx=".6" style={{ fill: "var(--peg-steel-hi)" }} />
      </svg>
    </span>
  );
}

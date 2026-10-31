/** Static menu illustration; D3 sprites can replace the placeholder board independently. */
export function TdArt() {
  return <svg viewBox="0 0 300 130" aria-hidden="true" className="td-mini">
    <path d="M0 30H210Q250 30 250 65T210 100H85" fill="none" stroke="var(--c-line)" strokeWidth="22" />
    <g fill="var(--c-paper)" stroke="var(--c-ink)" strokeWidth="3">
      <path d="M58 46h65v16H58zm-8 4h8v8h-8zm73 0h8v8h-8z" />
      <rect x="153" y="61" width="42" height="39" rx="9"/><path d="M161 73h26v18h-26z" />
      <ellipse cx="52" cy="99" rx="24" ry="16"/><path d="m43 89-5 9m17-10-5 10m16-6-5 10" />
    </g>
    <g fill="var(--c-ink)"><ellipse cx="22" cy="30" rx="7" ry="4"/><circle cx="32" cy="30" r="4"/></g>
  </svg>;
}

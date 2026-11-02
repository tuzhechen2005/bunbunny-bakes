import { copy } from '@/copy';
import { fill } from '@/components/customer/format';
const t = copy.customer.td;
const STAR = 'M12 2.6l2.9 6.1 6.7.8-4.9 4.6 1.3 6.6L12 17.4l-6 3.3 1.3-6.6L2.4 9.5l6.7-.8z';
/** One to three clay stars; unearned ones stay as faint outlines. */
export function Stars({ n, size = 22, pop = false }: { n: number; size?: number; pop?: boolean }) {
  return <span className="td-stars" role="img" aria-label={fill(t.starsLabel, { n })} data-testid="td-stars" data-stars={n}>
    {[1, 2, 3].map(i => <svg key={i} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className={`${i <= n ? 'td-star-on' : 'td-star-off'}${pop && i <= n ? ' td-star-pop' : ''}`} style={pop ? { animationDelay: `${i * 170}ms` } : undefined}>
      <path d={STAR} strokeLinejoin="round" />
    </svg>)}
  </span>;
}
/** The best stars earned this week, per level (only levels with at least one star). */
export function BestStars({ best }: { best: Record<string, number> }) {
  const rows = Object.entries(best).map(([level, n]) => ({ level: Number(level), n })).filter(r => r.n > 0).sort((a, b) => a.level - b.level).slice(-12);
  if (!rows.length) return null;
  return <div className="td-best" data-testid="td-best-stars" aria-label={t.bestStars}>
    {rows.map(r => <p key={r.level} className="td-best-row" data-testid={`td-best-${r.level}`} aria-label={fill(t.bestLabel, { level: r.level, n: r.n })}><b className="font-num">{r.level}</b><Stars n={r.n} size={13} /></p>)}
  </div>;
}

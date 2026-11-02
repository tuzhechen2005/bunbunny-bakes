import type { InputHTMLAttributes, ReactNode } from 'react';
import { copy } from '@/copy';
import { focusRing } from '@/components/ui/focus';
import './clay.css';

const g = copy.customer.game;
export const gamePrimary = `clay-btn font-display h-14 w-full text-lg ${focusRing}`;
export const gameSecondary = `clay-btn-2 min-h-12 w-full text-[15px] font-bold ${focusRing}`;

export function GameShell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className="game-skin flex flex-1 flex-col text-c-ink">
    <div className={`game-skin-inner mx-auto flex w-full max-w-[430px] flex-1 flex-col overflow-x-clip ${className}`}>{children}</div>
  </div>;
}

export function SpeakerButton({ on, onToggle, testId }: { on: boolean; onToggle: () => void; testId: string }) {
  return <button type="button" onClick={onToggle} aria-pressed={on} aria-label={on ? g.soundOff : g.soundOn}
    className={`grid size-11 shrink-0 place-items-center rounded-full text-c-ink ${focusRing}`} data-testid={testId}>
    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" />
      {on ? <path d="M15.5 9a4 4 0 010 6M18 6.5a8 8 0 010 11" /> : <path d="M16 9.5l5 5M21 9.5l-5 5" />}
    </svg>
  </button>;
}

export function ReplayButton({ onClick, testId }: { onClick: () => void; testId: string }) {
  return <button type="button" onClick={onClick} aria-label={g.replay}
    className={`grid size-11 shrink-0 place-items-center rounded-full text-c-ink ${focusRing}`} data-testid={testId}>
    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 12a8 8 0 11-2.6-5.9" /><path d="M20 4v4.5h-4.5" />
    </svg>
  </button>;
}

export function GameRegistrationField({ kind, testId, error, errorId, ...props }: {
  kind: 'wechat' | 'nickname'; testId: string; error?: string | null; errorId?: string;
} & InputHTMLAttributes<HTMLInputElement>) {
  return <label className="block">
    <span className="mb-1.5 block text-[13px] font-bold">{kind === 'wechat' ? g.wechatLabel : g.nicknameLabel}</span>
    <input {...props} placeholder={kind === 'wechat' ? g.wechatPlaceholder : g.nicknamePlaceholder}
      autoComplete="off" autoCapitalize={kind === 'wechat' ? 'off' : undefined}
      autoCorrect={kind === 'wechat' ? 'off' : undefined} spellCheck={kind === 'wechat' ? false : undefined}
      aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
      className="h-12 w-full rounded-2xl border border-c-line bg-c-paper px-4 text-base text-c-ink placeholder:text-c-grey-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-c-ink"
      data-testid={testId} />
    {error && <span id={errorId} role="alert" className="mt-1 block text-[13px] text-c-red">{error}</span>}
  </label>;
}

export type GameArtKey = 'big' | 'tu' | 'm3' | 'grab' | 'run' | 'td';
/** Menu header: the game's clay key art, full bleed, with the title set into its empty top. */
export function GameMenuHero({ game, title, hint, compact = false, children }: { game: GameArtKey; title: ReactNode; hint?: ReactNode; compact?: boolean; children?: ReactNode }) {
  return <header className={`game-hero${compact ? ' game-hero-compact' : ''}`}>
    {/* eslint-disable-next-line @next/next/no-img-element -- static art, already sized WebP */}
    <img className="game-hero-art" src={`/brand/art/menu-${game}.webp`} alt="" draggable={false} onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />
    <div className="game-hero-text">
      <h1 className="font-display">{title}</h1>
      {hint ? <p>{hint}</p> : null}
      {children}
    </div>
  </header>;
}

/** Result-screen clay art: a crown for a new record, a cheer for a good run, a cute sigh otherwise. */
export function GameResultArt({ record = false, lose = false }: { record?: boolean; lose?: boolean }) {
  const name = record ? 'record' : lose ? 'lose' : 'win';
  // eslint-disable-next-line @next/next/no-img-element -- static clay art
  return <img className={`game-result-art game-result-${name}`} src={`/brand/art/result-${name}.webp`} alt="" draggable={false} />;
}

import type { InputHTMLAttributes, ReactNode } from 'react';
import { copy } from '@/copy';
import { focusRing } from '@/components/ui/focus';

const g = copy.customer.game;
export const gamePrimary = `font-display h-14 w-full rounded-full bg-c-ink text-lg text-c-paper ${focusRing}`;
export const gameSecondary = `min-h-11 w-full rounded-full bg-c-wash text-[15px] font-bold ${focusRing}`;

export function GameShell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className="flex flex-1 flex-col bg-c-wash text-c-ink">
    <div className={`mx-auto flex w-full max-w-[430px] flex-1 flex-col overflow-x-clip bg-c-paper ${className}`}>{children}</div>
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

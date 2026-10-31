'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { TopBar } from '@/components/ui/TopBar';
import { focusRing } from '@/components/ui/focus';
import { GameShell, SpeakerButton, GameRegistrationField, gamePrimary, gameSecondary } from '@/components/game/GameChrome';
import { copy } from '@/copy';
import { fill } from '@/components/customer/format';
import { readRemembered, writeRemembered, isRetryable } from '@/components/game/gameApi';
import { sound, unlockAudio } from '@/components/game/sound';
import { LeaderboardView } from '@/components/game/LeaderboardView';
import { useGameHub } from '@/components/game/useGameHub';
import { useLiveProgress } from '@/components/game/useLiveProgress';
import { Sheet } from '@/components/ui/Sheet';
import { useMotionPrefs } from '@/lib/motion/react';
import { TdBoard, type TdProgress } from './TdBoard';
import { TdArt } from './TdArt';
import { fetchTdLeaderboard, finishTd, startTd, type TdFinish } from './tdApi';
import { clearTdSave, readTdSave, writeTdSave, type TdSave } from './tdSave';
import './td.css';
const t = copy.customer.td, g = copy.customer.game;
type Phase = 'menu' | 'form' | 'playing' | 'over' | 'board';
export function TdPage() {
  const [phase, setPhase] = useState<Phase>('menu'), [saved, setSaved] = useState<TdSave | null>(null), [run, setRun] = useState<TdSave | null>(null);
  const [wechat, setWechat] = useState(''), [nickname, setNickname] = useState(''), [soundOn, setSoundOn] = useState(false);
  const [errors, setErrors] = useState<{wechat: string | null; nick: string | null}>({wechat: null, nick: null});
  const [nextLevel, setNextLevel] = useState(1), [starting, setStarting] = useState(false), [error, setError] = useState('');
  const [dialog, setDialog] = useState<'exit' | 'restart' | null>(null), [showResult, setShowResult] = useState(false);
  const [localPassed, setLocalPassed] = useState(false);
  const [result, setResult] = useState<TdFinish | null>(null), [submitting, setSubmitting] = useState(false), [retry, setRetry] = useState(false);
  const active = useRef<TdSave | null>(null), progress = useRef<TdProgress>({inputs:[],endTick:0,score:0,passed:false});
  const inflight = useRef<string | null>(null), acknowledged = useRef<string | null>(null);
  const { reduced, degraded } = useMotionPrefs();
  const { data: hub } = useGameHub(); const hasPrize = hub?.prizeGame === 'TD';
  useEffect(() => {
    const remembered = readRemembered();
    // Browser-only preferences and persistence are read once after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWechat(remembered.wechatId); setNickname(remembered.nickname); setSoundOn(remembered.sound); setSaved(readTdSave());
  }, []);
  useEffect(() => {
    if (phase !== 'menu' || !wechat.trim()) return;
    let alive = true; void fetchTdLeaderboard(wechat.trim()).then(r => { if (alive && r.ok) setNextLevel(r.data.nextLevel); });
    return () => { alive = false; };
  }, [phase, wechat]);
  const persist = useCallback((p: TdProgress) => {
    progress.current = p;
    const current = active.current;
    if (current && acknowledged.current !== current.runId) writeTdSave({...current, inputs:p.inputs, endTick:p.endTick, score:p.score});
  }, []);
  const readProgress = useCallback(() => active.current && acknowledged.current !== active.current.runId
    ? {runId:active.current.runId,log:progress.current.inputs,endTick:progress.current.endTick} : null, []);
  useLiveProgress('/api/game/td/progress', phase === 'playing', readProgress);
  const submit = useCallback(async (p: TdProgress) => {
    const current = active.current;
    if (!current || inflight.current === current.runId || acknowledged.current === current.runId) return;
    const id = current.runId; inflight.current = id; setSubmitting(true); setError('');
    const r = await finishTd(id,p.inputs,p.endTick);
    if (inflight.current === id) inflight.current = null;
    if (active.current?.runId !== id) return;
    setSubmitting(false);
    if (r.ok) {
      acknowledged.current = id;
      if (readTdSave()?.runId === id) clearTdSave();
      setResult(r.data); setNextLevel(r.data.level + Number(r.data.passed)); setSaved(null);
    } else { setError(r.error.message); setRetry(isRetryable(r.status)); }
  }, []);
  const over = useCallback((p: TdProgress) => {
    persist(p); setLocalPassed(p.passed); setPhase('over'); setDialog(null); setShowResult(true); void submit(p);
  }, [persist, submit]);
  const activate = (s: TdSave) => {
    active.current = s; progress.current = {inputs:s.inputs,endTick:s.endTick,score:s.score,passed:false};
    acknowledged.current = null; setError(''); setResult(null); setSubmitting(false); setRetry(false); setShowResult(false);
    if (soundOn) unlockAudio(); setRun(s); setPhase('playing');
  };
  const begin = async (event?: FormEvent) => {
    event?.preventDefault(); if (starting) return;
    const validation = {
      wechat: !wechat.trim() || [...wechat.trim()].length > 40 ? g.wechatInvalid : null,
      nick: !nickname.trim() || [...nickname.trim()].length > 10 || /[\u0000-\u001f\u007f-\u009f]/.test(nickname) ? g.nicknameInvalid : null,
    };
    setErrors(validation); setError('');
    if (validation.wechat || validation.nick) { setPhase('form'); return; }
    setStarting(true); setError('');
    const level = result && run && Date.parse(run.expiresAt) > Date.now() ? result.level + Number(result.passed) : undefined;
    const r = await startTd(wechat.trim(), nickname.trim(), level); setStarting(false);
    if (!r.ok) { setError(r.error.message); setPhase('form'); return; }
    writeRemembered({wechatId:wechat.trim(),nickname:nickname.trim()});
    const s: TdSave = {...r.data,v:1,nickname:nickname.trim(),inputs:[],endTick:0,score:0};
    writeTdSave(s); activate(s);
  };
  const menu = (discard = false) => {
    if (discard) clearTdSave();
    active.current = null; setRun(null); setSaved(readTdSave()); setDialog(null); setShowResult(false); setPhase('menu');
  };
  const toggleSound = () => {
    const value = !soundOn; setSoundOn(value); writeRemembered({sound:value});
    if (value) { unlockAudio(); sound.drop(); }
  };
  const playing = phase === 'playing' || phase === 'over';
  return <GameShell className={`td-shell ${playing ? 'td-shell-playing' : ''}`}>
    <div onClickCapture={e => {
      if (phase === 'playing' && (e.target as Element).closest('a')) { e.preventDefault(); setDialog('exit'); }
    }}>
      <TopBar backHref="/game/hub" backLabel={copy.customer.gameHub.backLabel} title={phase === 'board' ? t.title : undefined}
        right={<div className="flex items-center">
          {phase === 'playing' && <button type="button" data-testid="td-exit" className={`min-h-11 shrink-0 rounded-full px-3 text-sm font-bold text-c-ink ${focusRing}`} onClick={() => setDialog('exit')}>{g.exit}</button>}
          <SpeakerButton testId="td-sound" on={soundOn} onToggle={toggleSound} />
        </div>} />
    </div>
    {phase === 'menu' && <main className="td-menu">
      <h1>{t.title}</h1><p className="td-level" data-testid="td-menu-level">{fill(t.level,{n:saved?.level ?? nextLevel})}</p>
      <p className="td-hint">{t.startHint}</p><TdArt /><p className="td-muted">{t.rules}</p>
      <p className={`font-display mt-6 text-center text-[15px] leading-snug ${hasPrize ? "" : "invisible"}`} aria-hidden={!hasPrize} data-testid={hasPrize ? "td-prize-line" : undefined}>{g.prizeLine}</p>
      {saved ? <><button className={gamePrimary} data-testid="td-resume" onClick={() => { const s = readTdSave(); if (s) activate(s); else setSaved(null); }}>{g.resume}</button>
        <button className={gameSecondary} data-testid="td-restart" onClick={() => setDialog('restart')}>{g.restart}</button></>
        : <button className={gamePrimary} data-testid="td-menu-start" onClick={() => {setError('');setPhase('form');}}>{nextLevel > 1 ? g.resume : g.start}</button>}
      <button className={gameSecondary} data-testid="td-open-board" onClick={() => setPhase('board')}>{g.viewBoard}</button>
    </main>}
    {phase === 'form' && <main className="td-menu td-form-page"><h1>{t.title}</h1><form onSubmit={begin} noValidate className="mt-6 flex flex-col gap-4" data-testid="td-form">
      <GameRegistrationField kind="wechat" testId="td-wechat" value={wechat} onChange={e => setWechat(e.target.value)} error={errors.wechat} errorId="td-wechat-err" />
      <GameRegistrationField kind="nickname" testId="td-nickname" value={nickname} onChange={e => setNickname(e.target.value)} error={errors.nick} errorId="td-nick-err" />
      {error && <p role="alert" className="m-0 text-sm text-c-red">{error}</p>}<button className={gamePrimary} data-testid="td-start" disabled={starting}>{starting ? g.starting : g.start}</button>
      <button className={gameSecondary} type="button" onClick={() => setPhase('menu')}>{g.closeBoard}</button>
    </form></main>}
    {phase === 'board' && <main><button className={`${gameSecondary} td-board-close`} data-testid="td-board-close" onClick={() => setPhase('menu')}>{g.closeBoard}</button><LeaderboardView scoreLabel={t.levels} hasPrize={hasPrize} wechatId={wechat.trim()} version={nextLevel} fetcher={fetchTdLeaderboard} /></main>}
    {playing && run && <><TdBoard key={run.runId} save={run} paused={dialog !== null} soundOn={soundOn} reduced={reduced || degraded} onProgress={persist} onOver={over} />
      {phase === 'over' && !showResult && <button className={gameSecondary} data-testid="td-show-result" onClick={() => setShowResult(true)}>{g.barScore}</button>}</>}
    {dialog && <Sheet label={dialog === 'exit' ? g.exitTitle : g.restartTitle} onClosed={() => setDialog(null)} panelTestId={`td-${dialog}-sheet`} className="td-sheet">
      <h2>{dialog === 'exit' ? g.exitTitle : g.restartTitle}</h2>
      {dialog === 'exit' ? <><button className={gamePrimary} data-testid="td-exit-save" onClick={() => menu()}>{g.exitSave}</button><button className={gameSecondary} data-testid="td-exit-discard" onClick={() => menu(true)}>{g.exitDiscard}</button></>
        : <button className={gamePrimary} data-testid="td-restart-confirm" onClick={() => { clearTdSave();setSaved(null);setDialog(null);setPhase('form'); }}>{g.restartConfirm}</button>}
      <button className={gameSecondary} data-testid="td-keep-playing" onClick={() => setDialog(null)}>{g.keepPlaying}</button>
    </Sheet>}
    {phase === 'over' && showResult && <Sheet label={result?.passed ?? localPassed ? t.win : t.fail} onClosed={() => setShowResult(false)} panelTestId="td-over-sheet" className="td-sheet">
      <h2>{(result?.passed ?? localPassed) ? t.win : t.fail}</h2>
      {submitting ? <p role="status">{g.submitting}</p> : error ? <><p role="alert" className="m-0 text-sm text-c-red">{error}</p>{retry && <button className={gameSecondary} data-testid="td-retry" onClick={() => void submit(progress.current)}>{g.retry}</button>}</> : result && <>
        <p data-testid="td-confirmed">{g.confirmed}</p><p>{t.levels} <b>{result.best}</b></p>
        <p>{g.personalBest} <b data-testid="td-personal-best">{result.personalBest ?? result.best}</b></p>
        {result.newRecord && <p>{g.newRecord}</p>}
      </>}
      <button className={gamePrimary} disabled={starting || submitting || (!result && retry)} data-testid="td-again" onClick={() => void begin()}>{result?.passed ? t.next : t.retry}</button>
      <button className={gameSecondary} onClick={() => menu()}>{g.closeBoard}</button>
    </Sheet>}
  </GameShell>;
}

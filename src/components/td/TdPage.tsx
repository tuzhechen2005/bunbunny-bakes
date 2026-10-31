'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
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
  const [nextLevel, setNextLevel] = useState(1), [starting, setStarting] = useState(false), [error, setError] = useState('');
  const [paused, setPaused] = useState(false), [dialog, setDialog] = useState<'exit' | 'restart' | null>(null), [showResult, setShowResult] = useState(false);
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
    acknowledged.current = null; setError(''); setResult(null); setSubmitting(false); setRetry(false); setPaused(false); setShowResult(false);
    if (soundOn) unlockAudio(); setRun(s); setPhase('playing');
  };
  const begin = async (event?: FormEvent) => {
    event?.preventDefault(); if (starting) return;
    if (!wechat.trim() || [...wechat.trim()].length > 40) { setError(g.wechatInvalid); setPhase('form'); return; }
    if (!nickname.trim() || [...nickname.trim()].length > 10 || /[\u0000-\u001f\u007f-\u009f]/.test(nickname)) { setError(g.nicknameInvalid); setPhase('form'); return; }
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
  return <div className={`td-shell ${playing ? 'td-shell-playing' : ''}`}>
    <header className="td-top">
      {playing ? <button data-testid="td-exit" onClick={() => phase === 'over' ? menu() : setDialog('exit')}>{g.exit}</button> : <Link href="/game/hub">{copy.customer.gameHub.backLabel}</Link>}
      {phase === 'playing' && <button data-testid="td-pause" aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? t.resume : t.pause}</button>}
      <button data-testid="td-sound" aria-pressed={soundOn} onClick={toggleSound}>{soundOn ? g.soundOff : g.soundOn}</button>
    </header>
    {phase === 'menu' && <main className="td-menu">
      <h1>{t.title}</h1><p className="td-level" data-testid="td-menu-level">{fill(t.level,{n:saved?.level ?? nextLevel})}</p>
      <TdArt /><p>{t.startHint}</p><p className="td-muted">{t.rules}</p>
      {hasPrize && <p data-testid="td-prize-line">{g.prizeLine}</p>}
      {saved ? <><button className="td-primary" data-testid="td-resume" onClick={() => { const s = readTdSave(); if (s) activate(s); else setSaved(null); }}>{g.resume}</button>
        <button data-testid="td-restart" onClick={() => setDialog('restart')}>{g.restart}</button></>
        : <button className="td-primary" data-testid="td-menu-start" onClick={() => {setError('');setPhase('form');}}>{nextLevel > 1 ? g.resume : g.start}</button>}
      <button data-testid="td-open-board" onClick={() => setPhase('board')}>{g.viewBoard}</button>
    </main>}
    {phase === 'form' && <main className="td-menu"><h1>{t.title}</h1><form onSubmit={begin} data-testid="td-form">
      <label>{g.wechatLabel}<input data-testid="td-wechat" value={wechat} onChange={e => setWechat(e.target.value)} autoCapitalize="off" autoComplete="off" /></label>
      <label>{g.nicknameLabel}<input data-testid="td-nickname" value={nickname} onChange={e => setNickname(e.target.value)} /></label>
      {error && <p role="alert">{error}</p>}<button className="td-primary" data-testid="td-start" disabled={starting}>{starting ? g.starting : g.start}</button>
      <button type="button" onClick={() => setPhase('menu')}>{g.closeBoard}</button>
    </form></main>}
    {phase === 'board' && <main><button className="td-board-close" onClick={() => setPhase('menu')}>{g.closeBoard}</button><LeaderboardView scoreLabel={t.levels} hasPrize={hasPrize} wechatId={wechat.trim()} version={nextLevel} fetcher={fetchTdLeaderboard} /></main>}
    {playing && run && <><TdBoard key={run.runId} save={run} paused={paused || dialog !== null} soundOn={soundOn} reduced={reduced || degraded} onProgress={persist} onOver={over} />
      {phase === 'over' && !showResult && <button data-testid="td-show-result" onClick={() => setShowResult(true)}>{g.barScore}</button>}</>}
    {dialog && <Sheet label={dialog === 'exit' ? g.exitTitle : g.restartTitle} onClosed={() => setDialog(null)} panelTestId={`td-${dialog}-sheet`} className="td-sheet">
      <h2>{dialog === 'exit' ? g.exitTitle : g.restartTitle}</h2>
      {dialog === 'exit' ? <><button className="td-primary" data-testid="td-exit-save" onClick={() => menu()}>{g.exitSave}</button><button data-testid="td-exit-discard" onClick={() => menu(true)}>{g.exitDiscard}</button></>
        : <button className="td-primary" data-testid="td-restart-confirm" onClick={() => { clearTdSave();setSaved(null);setDialog(null);setPhase('form'); }}>{g.restartConfirm}</button>}
      <button onClick={() => setDialog(null)}>{g.keepPlaying}</button>
    </Sheet>}
    {phase === 'over' && showResult && <Sheet label={result?.passed ?? localPassed ? t.win : t.fail} onClosed={() => setShowResult(false)} panelTestId="td-over-sheet" className="td-sheet">
      <h2>{(result?.passed ?? localPassed) ? t.win : t.fail}</h2>
      {submitting ? <p role="status">{g.submitting}</p> : error ? <><p role="alert">{error}</p>{retry && <button data-testid="td-retry" onClick={() => void submit(progress.current)}>{g.retry}</button>}</> : result && <>
        <p data-testid="td-confirmed">{g.confirmed}</p><p>{t.levels} <b>{result.best}</b></p>
        <p>{g.personalBest} <b data-testid="td-personal-best">{result.personalBest ?? result.best}</b></p>
        {result.newRecord && <p>{g.newRecord}</p>}
      </>}
      <button className="td-primary" disabled={starting || submitting || (!result && retry)} data-testid="td-again" onClick={() => void begin()}>{result?.passed ? t.next : t.retry}</button>
      <button onClick={() => menu()}>{g.closeBoard}</button>
    </Sheet>}
  </div>;
}

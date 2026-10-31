'use client';
/* eslint-disable @next/next/no-img-element -- Owner TierView photos already have delivery URLs. */
import { useEffect, useRef, useState } from 'react';
import { createTdGame, TD_MAPS, MAX_INPUTS, towerStats, TOWER_KINDS, type TdInput, type TdState } from '@/lib/td';
import { copy } from '@/copy';
import { fill } from '@/components/customer/format';
import { sound } from '@/components/game/sound';
import { haptic } from '@/lib/motion/react';
import { applyTdClientInput } from './tdInput';
import { gameSecondary } from '@/components/game/GameChrome';
import { createTdClock } from './tdClock';
import { preloadTdArt } from './tdAssets';
import { breadImages, createTdRenderer } from './tdRenderer';
import type { TdSave } from './tdSave';

const t = copy.customer.td;
export interface TdProgress { inputs: TdInput[]; endTick: number; score: number; passed: boolean }
type Action = { type: 'place'; slot: number; tower: typeof TOWER_KINDS[number] } | { type: 'upgrade' | 'sell'; slot: number } | { type: 'callWave'; slot: -1 };
interface Props { save: TdSave; paused: boolean; soundOn: boolean; reduced: boolean; onProgress: (p: TdProgress) => void; onOver: (p: TdProgress) => void }
export function TdBoard({ save, paused, soundOn, reduced, onProgress, onOver }: Props) {
  const [game] = useState(() => {
    const g = createTdGame({ seed: save.seed, tierCount: save.tiers.length });
    for (const input of save.inputs) g.apply(input);
    g.step(save.endTick); return g;
  });
  const [clock] = useState(() => createTdClock(save.endTick));
  const [hud, setHud] = useState(() => game.state());
  const [ready, setReady] = useState(false), [hidden, setHidden] = useState(false);
  const [selected, setSelected] = useState<number | null>(null), [speed, setSpeed] = useState<1 | 2>(1);
  const canvas = useRef<HTMLCanvasElement>(null), wrapper = useRef<HTMLDivElement>(null);
  const state = useRef<TdState>(hud), inputs = useRef([...save.inputs]);
  const reported = useRef(false), action = useRef<(a: Action) => void>(() => {});
  const settings = useRef({ soundOn, reduced });
  useEffect(() => { settings.current = { soundOn, reduced }; }, [soundOn, reduced]);
  useEffect(() => {
    let alive = true, active = false, raf: number | null = null, timer: ReturnType<typeof setInterval> | null = null;
    let render: ((s: TdState) => void) | null = null, lastSave = -1;
    const publish = (force = false) => {
      const s = game.state(); state.current = s;
      if (wrapper.current) { wrapper.current.dataset.tick = String(s.tick); wrapper.current.dataset.state = s.over ? (s.passed ? 'won' : 'lost') : 'playing'; }
      setHud(old => old.coins !== s.coins || old.wave !== s.wave || old.bread !== s.bread || old.towers.length !== s.towers.length
        || old.inputsAccepted !== s.inputsAccepted || old.inputsRejected !== s.inputsRejected || old.nextWaveTick !== s.nextWaveTick || old.over !== s.over ? s : old);
      if (force || Math.floor(s.tick / 60) !== lastSave || s.over) {
        lastSave = Math.floor(s.tick / 60);
        const progress = { inputs: inputs.current, endTick: s.tick, score: s.wave, passed: s.passed };
        onProgress(progress);
        if (s.over && !reported.current) { reported.current = true; if (settings.current.soundOn) sound.over(); onOver(progress); }
      }
    };
    const stop = () => {
      active = false;
      if (raf !== null) cancelAnimationFrame(raf); raf = null;
      if (timer !== null) clearInterval(timer); timer = null;
      game.step(clock.pause(performance.now())); publish(true); render?.(state.current);
    };
    // Rendering consumes the latest simulation snapshot and creates no arrays, objects or strings.
    const frame = () => { if (!active) return; render!(state.current); raf = requestAnimationFrame(frame); };
    const simulate = () => { game.step(clock.tick(performance.now())); publish(); if (game.over) stop(); };
    const start = () => {
      if (!alive || active || paused || document.hidden || game.over || !render) return;
      active = true; clock.resume(performance.now()); timer = setInterval(simulate, 1000 / 30); raf = requestAnimationFrame(frame);
    };
    const visibility = () => { setHidden(document.hidden); if (document.hidden) stop(); else start(); };
    const resize = () => {
      const c = canvas.current; if (!c) return;
      const rect = c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.max(1, Math.round(rect.width*dpr)); c.height = Math.max(1, Math.round(rect.height*dpr)); render?.(state.current);
    };
    const observer = new ResizeObserver(resize); if (canvas.current) observer.observe(canvas.current);
    action.current = a => {
      if (!active || document.hidden || game.over || inputs.current.length >= MAX_INPUTS) return;
      game.step(clock.tick(performance.now()));
      if (game.over) { publish(true); stop(); return; }
      const input = { ...a, tick: game.state().tick } as TdInput;
      // Retain replayable rejected attempts only up to the client safety margin.
      const accepted = applyTdClientInput(game, inputs.current, input);
      if (accepted) { if (settings.current.soundOn) sound.drop(); if (!settings.current.reduced) haptic(8); }
      publish(true); render?.(state.current);
    };
    document.addEventListener('visibilitychange', visibility, true); window.addEventListener('pagehide', stop, true);
    void Promise.all([preloadTdArt(), breadImages(save.tiers)]).then(([art, photos]) => {
      if (!alive || !canvas.current) return;
      render = createTdRenderer(canvas.current, state.current.map, art, save.tiers, photos, reduced);
      resize(); setReady(true); publish(true); start();
    });
    return () => {
      alive = false; stop(); observer.disconnect(); action.current = () => {};
      document.removeEventListener('visibilitychange', visibility, true); window.removeEventListener('pagehide', stop, true);
    };
  }, [clock, game, onProgress, onOver, paused, reduced, save.tiers]);
  const tower = selected === null ? undefined : hud.towers.find(v => v.slot === selected);
  const slots = TD_MAPS[hud.map].slots;
  const point = selected === null ? null : slots[selected];
  const target = save.tiers[hud.waveTargetTier];
  const disabled = paused || hidden || hud.over || !ready || hud.inputsAccepted + hud.inputsRejected >= MAX_INPUTS;
  return <section className="td-play">
    <div className="td-hud" aria-live="off">
      <p>{t.levels}<b className="font-num" data-testid="td-level">{save.level}</b></p><p>{t.wave}<b className="font-num" data-testid="td-wave">{hud.wave}/5</b></p>
      <p>{t.coins}<b className="font-num" data-testid="td-coins">{hud.coins}</b></p><p>{t.bread}<b className="font-num" data-testid="td-bread">{hud.bread}</b></p>
    </div>
    <div className="td-target"><span>{t.target}</span>{target?.imageUrl ? <img src={target.imageUrl} alt={target.name ?? ''} width={26} height={26} /> : <span aria-hidden="true">◒</span>}</div>
    <div className="td-field-wrap"><div className="td-field" ref={wrapper} data-testid="td-board" aria-label={t.boardLabel}>
      <canvas ref={canvas} aria-hidden="true" />
      {slots.map((slot, i) => <button key={i} type="button" className="td-slot" data-testid={`td-slot-${i}`} disabled={disabled}
        style={{ left: `${slot.x/7.2}%`, top: `${slot.y/10.8}%` }} aria-label={fill(t.slot,{n:i+1})} aria-expanded={selected === i}
        onClick={() => setSelected(selected === i ? null : i)} />)}
      {point && !disabled && <div className={`td-picker ${tower ? 'td-picker-built' : ''}`} role="group" aria-label={fill(t.slot,{n:selected!+1})}
        style={{ left: `clamp(96px, ${point.x/7.2}%, calc(100% - 96px))`, top: `clamp(96px, ${point.y/10.8}%, calc(100% - 96px))` }}>
        {tower ? <>
          <button disabled={tower.level === 2 || hud.coins < towerStats(tower.kind, tower.level+1).cost} onClick={() => { action.current({type:'upgrade',slot:selected!}); setSelected(null); }} data-testid="td-upgrade">{t.upgrade}<b>{tower.level === 2 ? '—' : towerStats(tower.kind,tower.level+1).cost}</b></button>
          <button onClick={() => { action.current({type:'sell',slot:selected!}); setSelected(null); }} data-testid="td-sell">{t.sell}<b>+{Math.floor(tower.spent/2)}</b></button>
        </> : TOWER_KINDS.map(kind => <button key={kind} data-testid={`td-build-${kind}`} disabled={hud.coins < towerStats(kind).cost}
          onClick={() => { action.current({type:'place',slot:selected!,tower:kind}); setSelected(null); }}>{t.towers[kind]}<b>{towerStats(kind).cost}</b></button>)}
        <button className="td-picker-close" aria-label={t.closePicker} onClick={() => setSelected(null)}>×</button>
      </div>}
      {(!ready || paused || hidden) && <p className="td-overlay" role="status">{!ready ? t.loading : t.paused}</p>}
    </div></div>
    <div className="td-controls">
      <button className={gameSecondary} data-testid="td-speed" aria-pressed={speed === 2} disabled={disabled} onClick={() => { const value = speed === 1 ? 2 : 1; clock.speed(value, performance.now()); setSpeed(value); }}>{speed === 1 ? t.speedOne : t.speedTwo}</button>
      <button className={gameSecondary} data-testid="td-call-wave" disabled={disabled || hud.nextWaveTick === null} onClick={() => action.current({type:'callWave',slot:-1})}>{t.nextWave}</button>
    </div>
    {hud.inputsAccepted + hud.inputsRejected >= MAX_INPUTS && <p role="status">{t.inputLimit}</p>}
  </section>;
}

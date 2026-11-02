'use client';
/* eslint-disable @next/next/no-img-element -- Static sprite files and owner photos. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createTdGame, FIELD_WIDTH, FIELD_HEIGHT, TD_SLOT_RADIUS, pathLength, pathPosition, type TdItem, MAX_INPUTS, WAVE_COUNT, towerStats, type TdInput, type TdState, type TowerKind, type TdBranch } from '@/lib/td';
import { copy } from '@/copy';
import { fill } from '@/components/customer/format';
import { sound } from '@/components/game/sound';
import { haptic } from '@/lib/motion/react';
import { applyTdClientInput } from './tdInput';
import { createTdClock } from './tdClock';
import { preloadTdArt } from './tdAssets';
import { breadImages, createTdRenderer, loadTdDeco, type TdView } from './tdRenderer';
import type { TdSave } from './tdSave';

const t = copy.customer.td;
const towerFile: Record<TowerKind, string> = { rollingPin: 'tower-pin', flourSifter: 'tower-sifter', whisk: 'tower-whisk', oven: 'tower-oven', freezer: 'tower-freezer', pipingBag: 'tower-piping', caramelTorch: 'tower-torch' };
const ITEMS: TdItem[] = ['bomb', 'bell', 'slide'];
const ITEM_LEVEL: Record<TdItem, number> = { bomb: 2, bell: 6, slide: 10 };
const PESTS = ['ant', 'mouse', 'sparrow', 'beetle', 'boss'] as const;
export interface TdProgress { inputs: TdInput[]; endTick: number; score: number; passed: boolean }
/** Inventory handed out by the server at level start (E1); absent → no items this level. */
const itemsOf = (save: TdSave): Partial<Record<TdItem, number>> => save.inventory ?? {};
type Action = { type: 'place'; slot: number; tower: TowerKind } | { type: 'upgrade'; slot: number; branch?: TdBranch } | { type: 'sell'; slot: number } | { type: 'callWave'; slot: -1 } | { type: 'switch'; fork: number } | { type: 'item'; item: 'bomb'; x: number; y: number } | { type: 'item'; item: 'bell' } | { type: 'item'; item: 'slide'; position: number };
interface Props { save: TdSave; paused: boolean; soundOn: boolean; reduced: boolean; onProgress: (p: TdProgress) => void; onOver: (p: TdProgress) => void }

const hudKey = (s: TdState) => `${s.coins}|${s.wave}|${s.bread}|${s.towers.map(v => `${v.slot}${v.level}${v.branch ?? ''}`).join(',')}|${s.inputsAccepted}|${s.inputsRejected}|${s.nextWaveTick === null}|${s.over}|${s.nextWave?.index ?? -1}|${s.waveTargetTier}|${s.awaitingStart}`;

function BranchCard({ kind, branch, coins, onPick }: { kind: TowerKind; branch: TdBranch; coins: number; onPick: (b: TdBranch) => void }) {
  const cost = towerStats(kind, 2, branch).cost;
  return <button className={`td-card td-branch-${branch}`} data-testid={`td-upgrade-${branch}`} disabled={coins < cost} onClick={() => onPick(branch)}>
    <span>{t.branches[kind][branch]}</span><b className="font-num">{cost}</b></button>;
}

export function TdBoard({ save, paused: pagePaused, soundOn, reduced, onProgress, onOver }: Props) {
  const [game] = useState(() => {
    const g = createTdGame({ seed: save.seed, tierCount: save.tiers.length, itemsAllowed: itemsOf(save) });
    for (const input of save.inputs) g.apply(input);
    g.step(save.endTick); return g;
  });
  const [clock] = useState(() => createTdClock(save.endTick));
  const [hud, setHud] = useState(() => game.state());
  const [ready, setReady] = useState(false), [hidden, setHidden] = useState(false);
  const [selected, setSelected] = useState<number | null>(null), [speed, setSpeed] = useState<1 | 2 | 3>(1);
  const [preview, setPreview] = useState<TowerKind | null>(null);
  const [boss, setBoss] = useState(false);
  const [info, setInfo] = useState(false);
  const [hold, setHold] = useState(false);
  const [aim, setAim] = useState<'bomb' | 'slide' | null>(null);
  const [unlockSeen, setUnlockSeen] = useState(false);
  const paused = pagePaused || hold;
  const canvas = useRef<HTMLCanvasElement>(null), wrapper = useRef<HTMLDivElement>(null);
  const state = useRef<TdState>(hud), inputs = useRef([...save.inputs]);
  const reported = useRef(false), action = useRef<(a: Action) => void>(() => {});
  const view = useRef<TdView | null>(null);
  const ui = useRef({ selected: null as number | null, preview: null as TowerKind | null });
  useEffect(() => { ui.current = { selected, preview }; }, [selected, preview]);
  const settings = useRef({ soundOn, reduced });
  useEffect(() => { settings.current = { soundOn, reduced }; }, [soundOn, reduced]);
  useEffect(() => {
    let alive = true, active = false, raf: number | null = null, lastSave = -1, lastKey = '', lastHud = 0;
    const publish = (force = false) => {
      const s = game.state(); state.current = s;
      if (wrapper.current) { wrapper.current.dataset.tick = String(s.tick); wrapper.current.dataset.state = s.over ? (s.passed ? 'won' : 'lost') : 'playing'; }
      const now = performance.now();
      if (force || now - lastHud > 120) {
        lastHud = now;
        const key = hudKey(s);
        if (key !== lastKey) { lastKey = key; setHud(s); }
      }
      if (force || Math.floor(s.tick / 60) !== lastSave || s.over) {
        lastSave = Math.floor(s.tick / 60);
        const progress = { inputs: inputs.current, endTick: s.tick, score: s.wave, passed: s.passed };
        onProgress(progress);
        if (s.over && !reported.current) { reported.current = true; if (settings.current.soundOn) sound.over(); onOver(progress); }
      }
    };
    const advance = () => {
      const events = game.step(clock.tick(performance.now()));
      if (events.length) {
        view.current?.ingest(events, game.state());
        for (const e of events) {
          if (e.type === 'kill' && settings.current.soundOn) sound.merge(1);
          if (e.type === 'bossSpawn') { setBoss(true); setTimeout(() => setBoss(false), 1800); if (!settings.current.reduced) haptic(30); }
          if (e.type === 'lose' && !settings.current.reduced) haptic(16);
        }
      }
    };
    const stop = () => {
      active = false;
      if (raf !== null) cancelAnimationFrame(raf); raf = null;
      game.step(clock.pause(performance.now())); publish(true); view.current?.draw(state.current, ui.current.selected, ui.current.preview);
    };
    // One rAF drives both simulation and drawing: motion is as smooth as the display.
    const frame = () => {
      if (!active) return;
      advance(); publish();
      view.current?.draw(state.current, ui.current.selected, ui.current.preview);
      if (game.over) { stop(); return; }
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (!alive || active || paused || document.hidden || game.over || !view.current) return;
      active = true; clock.resume(performance.now()); raf = requestAnimationFrame(frame);
    };
    const visibility = () => { setHidden(document.hidden); if (document.hidden) stop(); else start(); };
    const resize = () => { view.current?.resize(); view.current?.draw(state.current, ui.current.selected, ui.current.preview); };
    const observer = new ResizeObserver(resize); if (canvas.current) observer.observe(canvas.current);
    action.current = a => {
      if (!active || document.hidden || game.over || inputs.current.length >= MAX_INPUTS) return;
      advance();
      if (game.over) { publish(true); stop(); return; }
      const before = game.state().events.length;
      const input = { ...a, tick: game.state().tick } as TdInput;
      // Retain replayable rejected attempts only up to the client safety margin.
      const accepted = applyTdClientInput(game, inputs.current, input);
      if (accepted) {
        const s = game.state(); view.current?.ingest(s.events.slice(before), s);
        if (settings.current.soundOn) sound.drop(); if (!settings.current.reduced) haptic(8);
      }
      publish(true);
    };
    document.addEventListener('visibilitychange', visibility, true); window.addEventListener('pagehide', stop, true);
    void Promise.all([preloadTdArt(), breadImages(save.tiers), loadTdDeco()]).then(([art, photos, deco]) => {
      if (!alive || !canvas.current) return;
      view.current = createTdRenderer(canvas.current, state.current.mapData, art, save.tiers, photos, reduced, deco);
      resize(); setReady(true); publish(true); start();
    });
    return () => {
      alive = false; stop(); observer.disconnect(); action.current = () => {}; view.current = null;
      document.removeEventListener('visibilitychange', visibility, true); window.removeEventListener('pagehide', stop, true);
    };
  }, [clock, game, onProgress, onOver, paused, reduced, save.tiers]);
  // Redraw immediately when the selection changes while paused or idle.
  useEffect(() => { view.current?.draw(state.current, selected, preview); }, [selected, preview]);

  const tower = selected === null ? undefined : hud.towers.find(v => v.slot === selected);
  const slots = hud.mapData.slots;
  const forks = (hud.mapData.features ?? []).filter(f => f.type === 'fork' && f.switchable);
  const allowed = itemsOf(save);
  const target = save.tiers[hud.waveTargetTier];
  const disabled = paused || hidden || hud.over || !ready || hud.inputsAccepted + hud.inputsRejected >= MAX_INPUTS;
  const close = useCallback(() => { setSelected(null); setPreview(null); }, []);
  const act = useCallback((a: Action) => { action.current(a); close(); }, [close]);
  const next = hud.nextWave;
  return <section className="td-play">
    <div className="td-hud" aria-live="off">
      <p className="td-hud-level"><span>{t.levels}</span><b className="font-num" data-testid="td-level">{save.level}</b></p>
      <div className="td-waves" aria-label={`${t.wave} ${hud.wave}/${WAVE_COUNT}`}>
        <span className="td-sr" data-testid="td-wave">{hud.wave}/{WAVE_COUNT}</span>
        {Array.from({ length: WAVE_COUNT }, (_, i) => <i key={i} className={i < hud.wave ? 'td-wave-done' : ''} aria-hidden="true" />)}
      </div>
      <p className="td-chip td-chip-coin"><i aria-hidden="true" /><b className="font-num" data-testid="td-coins">{hud.coins}</b></p>
      {ITEMS.some(k => (allowed[k] ?? 0) > 0 && save.level >= ITEM_LEVEL[k]) && <div className="td-items">
        {ITEMS.filter(k => (allowed[k] ?? 0) > 0 && save.level >= ITEM_LEVEL[k]).map(k => <button key={k} type="button" className="td-item" data-testid={`td-item-${k}`}
          aria-label={t.items[k]} aria-pressed={aim === k} disabled={disabled || !!hud.itemsUsed[k]}
          onClick={() => { if (k === 'bell') action.current({ type: 'item', item: 'bell' }); else setAim(aim === k ? null : k); }}>
          <img src={`/brand/art/shop/item-${k}.webp`} alt="" /></button>)}
      </div>}
      <p className="td-chip td-chip-bread">{target?.imageUrl ? <img src={target.imageUrl} alt="" /> : <i aria-hidden="true" />}<b className="font-num" data-testid="td-bread">{hud.bread}</b></p>
    </div>
    <div className="td-next" aria-label={t.nextWaveLabel}>
      {next ? <>
        <span>{t.nextWaveLabel}</span>
        {PESTS.filter(k => next.counts[k] > 0).map(k => <span key={k} className="td-next-pest"><i className={`td-pest-icon td-pest-${k}`} aria-hidden="true" />×{next.counts[k]}</span>)}
      </> : <span>{t.lastWave}</span>}
    </div>
    <div className="td-field-wrap"><div className="td-field" style={{ aspectRatio: `${FIELD_WIDTH} / ${FIELD_HEIGHT}` }} ref={wrapper} data-testid="td-board" aria-label={t.boardLabel}>
      <canvas ref={canvas} aria-hidden="true" />
      {slots.map((slot, i) => <button key={i} type="button" className="td-slot" data-testid={`td-slot-${i}`} disabled={disabled}
        style={{ left: `${slot.x / FIELD_WIDTH * 100}%`, top: `${slot.y / FIELD_HEIGHT * 100}%`, width: `${TD_SLOT_RADIUS * 2.3 / FIELD_WIDTH * 100}%` }} aria-label={fill(t.slot, { n: i + 1 })} aria-expanded={selected === i}
        onClick={() => { if (selected === i) close(); else { setSelected(i); setPreview(null); } }} />)}
      {forks.map(f => { const at = f.geometry[0]; return at ? <button key={f.id} type="button" className="td-switch" data-testid={`td-switch-${f.id}`} aria-label={t.switchLabel} disabled={disabled}
        style={{ left: `${at.x / FIELD_WIDTH * 100}%`, top: `${(at.y - 70) / FIELD_HEIGHT * 100}%` }} onClick={() => action.current({ type: 'switch', fork: f.id })} /> : null; })}
      {aim && <div className="td-aim" data-testid="td-aim" onClick={e => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const x = Math.round((e.clientX - r.left) / r.width * FIELD_WIDTH), y = Math.round((e.clientY - r.top) / r.height * FIELD_HEIGHT);
        if (aim === 'bomb') action.current({ type: 'item', item: 'bomb', x, y });
        else {
          // Nearest point on the route, sampled every ~4 field units (engine validates the position).
          const map = hud.mapData, total = pathLength(map); let best = 0, bestD = Infinity;
          for (let d = 0; d <= total; d += 64) { const p = pathPosition(map, d), dd = (p.x - x) ** 2 + (p.y - y) ** 2; if (dd < bestD) { bestD = dd; best = d; } }
          action.current({ type: 'item', item: 'slide', position: best });
        }
        setAim(null);
      }}><p className="td-start-hint font-display">{aim === 'bomb' ? t.aimBomb : t.aimSlide}</p>
        <button type="button" className="td-ctl td-aim-cancel" onClick={e => { e.stopPropagation(); setAim(null); }}>{t.aimCancel}</button></div>}
      {hud.newlyUnlocked.length > 0 && !unlockSeen && ready && <div className="td-unlock" role="dialog" aria-label={t.newTower} data-testid="td-unlock">
        <span className="td-unlock-badge font-display">{t.newTower}</span>
        {hud.newlyUnlocked.map(kind => <div key={kind} className="td-unlock-row"><img src={`/brand/td/${towerFile[kind]}-0.webp`} alt="" /><div><b className="font-display">{t.towers[kind]}</b><p>{t.info[kind].base}</p></div></div>)}
        <button className="td-ctl td-ctl-main" data-testid="td-unlock-ok" onClick={() => setUnlockSeen(true)}>{t.gotIt}</button>
      </div>}
      {boss && <p className="td-boss" role="status">{t.boss}</p>}
      {hud.awaitingStart && ready && selected === null && !hold && <p className="td-start-hint font-display" role="status">{t.startHint2}</p>}
      {selected !== null && !disabled && <div className={`td-tray${slots[selected].y > FIELD_HEIGHT * .57 ? " td-tray-top" : ""}`} role="group" aria-label={fill(t.slot, { n: selected + 1 })}>
        {tower ? <>
          <div className="td-tray-head"><img src={`/brand/td/${towerFile[tower.kind]}-${tower.level}.webp`} alt="" /><b>{t.towers[tower.kind]}</b></div>
          {tower.level === 0 && <button className="td-card" data-testid="td-upgrade" disabled={hud.coins < towerStats(tower.kind, 1).cost}
            onClick={() => act({ type: 'upgrade', slot: selected })}><span>{t.upgrade}</span><b className="font-num">{towerStats(tower.kind, 1).cost}</b></button>}
          {tower.level === 1 && <>
            <BranchCard kind={tower.kind} branch="a" coins={hud.coins} onPick={b => act({ type: 'upgrade', slot: selected, branch: b })} />
            <BranchCard kind={tower.kind} branch="b" coins={hud.coins} onPick={b => act({ type: 'upgrade', slot: selected, branch: b })} />
          </>}
          {tower.level === 2 && <button className="td-card" data-testid="td-upgrade" disabled><span>{t.maxed}</span><b>—</b></button>}
          <button className="td-card td-sell" data-testid="td-sell" onClick={() => act({ type: 'sell', slot: selected })}><span>{t.sell}</span><b className="font-num">+{Math.floor(tower.spent / 2)}</b></button>
        </> : hud.unlockedTowers.map(kind => <button key={kind} className="td-card td-build" data-testid={`td-build-${kind}`} disabled={hud.coins < towerStats(kind).cost}
          onPointerEnter={() => setPreview(kind)} onFocus={() => setPreview(kind)}
          onClick={() => act({ type: 'place', slot: selected, tower: kind })}>
          <img src={`/brand/td/${towerFile[kind]}-0.webp`} alt="" /><span>{t.towers[kind]}</span><b className="font-num">{towerStats(kind).cost}</b></button>)}
        <button className="td-tray-info" aria-label={t.infoOpen} data-testid="td-info-open" onClick={() => setInfo(true)}>?</button>
        <button className="td-tray-close" aria-label={t.closePicker} onClick={close}>×</button>
      </div>}
      {info && <div className="td-info" role="dialog" aria-label={t.infoTitle} data-testid="td-info">
        <b className="font-display">{t.infoTitle}</b>
        <div className="td-info-grid">{hud.unlockedTowers.map(kind => <div key={kind} className="td-info-row">
          <img src={`/brand/td/${towerFile[kind]}-0.webp`} alt="" />
          <div><b>{t.towers[kind]}</b><p>{t.info[kind].base}</p>
            <p className="td-info-branch"><i className="td-dot-a" />{t.info[kind].a}</p>
            <p className="td-info-branch"><i className="td-dot-b" />{t.info[kind].b}</p></div>
        </div>)}</div>
        <button className="td-ctl td-ctl-main" onClick={() => setInfo(false)}>{t.infoClose}</button>
      </div>}
      {hold && !hud.over && <div className="td-hold-cover" role="dialog" aria-label={t.paused}>
        <b className="font-display">{t.paused}</b>
        <button className="td-ctl td-ctl-main" data-testid="td-hold-resume" onClick={() => setHold(false)}>{t.resume}</button>
      </div>}
      {(!ready || (pagePaused && !hold) || hidden) && <p className="td-overlay" role="status">{!ready ? t.loading : t.paused}</p>}
    </div></div>
    <div className="td-controls">
      <button className="td-ctl td-ctl-hold" data-testid="td-hold" aria-pressed={hold} aria-label={hold ? t.resume : t.pause} disabled={pagePaused || hidden || hud.over || !ready} onClick={() => setHold(h => !h)}>{hold ? '▶' : 'Ⅱ'}</button>
      <button className="td-ctl td-ctl-info" data-testid="td-info-side" onClick={() => setInfo(true)} aria-label={t.infoOpen}>?</button>
      <button className="td-ctl" data-testid="td-speed" aria-pressed={speed > 1} disabled={disabled} onClick={() => { const value = speed === 3 ? 1 : speed === 1 ? 2 : 3; clock.speed(value, performance.now()); setSpeed(value); }}>{speed === 1 ? t.speedOne : speed === 2 ? t.speedTwo : t.speedThree}</button>
      <button className={`td-ctl td-ctl-main${hud.awaitingStart ? ' td-ctl-go' : ''}`} data-testid="td-call-wave" disabled={disabled || (hud.nextWaveTick === null && !hud.awaitingStart)} onClick={() => action.current({ type: 'callWave', slot: -1 })}>{hud.awaitingStart ? t.startWave : t.nextWave}</button>
    </div>
    {hud.inputsAccepted + hud.inputsRejected >= MAX_INPUTS && <p role="status">{t.inputLimit}</p>}
  </section>;
}

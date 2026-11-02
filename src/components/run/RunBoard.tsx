"use client";
/* eslint-disable @next/next/no-img-element -- static clay HUD icons */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createRunGame, MAX_INPUTS, MAGNET_TICKS, COFFEE_TICKS, type RunInput, type RunDirection, type RunEvent, type RunState, type RunDeath } from "@/lib/run";
import { copy } from "@/copy";
import { sound } from "@/components/game/sound";
import { haptic, useMotionPrefs } from "@/lib/motion/react";
import { createRunClock, elapsedTick } from "./runClock";
import { preloadRunArt, type RunArt } from "./runAssets";
import { createRunView, type RunView } from "./runView";
import { swipeDirection } from "./runHelpers";
import { RunSprite } from "./RunArt";

export interface RunProgress { inputs: RunInput[]; score: number; elapsedMs: number; endTick: number; death?: RunDeath | null }
interface Props {
  seed: string; initialInputs?: RunInput[]; initialElapsedMs?: number;
  soundOn: boolean; reduced: boolean; paused: boolean;
  onProgress: (p: RunProgress) => void; onOver: (p: RunProgress) => void; onShowResult?: () => void;
}
const t=copy.customer.run;
const HUD_INTERVAL_MS = 100;
const EMPTY_EVENTS:RunEvent[]=[];
const SPRINT_M = 400;
const TAKEOVER_TICKS = 120;
// Practice cues fire at ticks 1 / 241 / 481 (lane change, jump, slide).
const practiceCue = (tick: number) => tick < 240 ? 1 : tick < 480 ? 2 : 3;
const hudValues = (s: RunState) => {
  const phase = s.phase ?? "running", left = s.controlTick - s.tick;
  return {
    distance: Math.floor(s.distance/1000), bread: s.bread, over: s.over,
    magnetTicks: s.powerUps.magnetTicks, coffeeTicks: s.powerUps.coffeeTicks,
    shoesTicks: s.powerUps.shoesTicks ?? 0, shield: !!s.player.shield, multiplier: s.multiplier ?? 1,
    phase, lane: s.player.lane, fast: s.speed >= 640,
    // Whole seconds left until the player takes over (2, 1), 0 when not in the countdown.
    takeover: phase === "sprint" && left > 0 && left <= TAKEOVER_TICKS ? Math.ceil(left / 60) : 0,
    sprintPct: phase === "sprint" ? Math.min(100, Math.floor(s.distance / 10 / SPRINT_M)) : 0,
    cue: phase === "practice" ? practiceCue(s.tick) : 0,
    comboLevel: s.combo?.level ?? 1, grace: s.combo?.graceAvailable ?? true,
  };
};
type Hud = ReturnType<typeof hudValues>;
const sameHud = (a: Hud, b: Hud) => (Object.keys(a) as (keyof Hud)[]).every(k => a[k] === b[k]);
const CUE_ICON = {
  1: "M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4",
  2: "M12 20V5M6 11l6-6 6 6",
  3: "M12 4v15M6 13l6 6 6-6",
} as const;
export function RunBoard({seed,initialInputs=[],initialElapsedMs=0,soundOn,reduced,paused,onProgress,onOver,onShowResult}:Props) {
  const {degraded}=useMotionPrefs();
  const quiet=reduced||degraded;
  const [game]=useState(()=>{
    const g=createRunGame({seed,realtime:true});
    initialInputs.forEach(i=>g.input(i.tick,i.dir));g.step(elapsedTick(initialElapsedMs));return g;
  });
  const [clock]=useState(()=>createRunClock(initialElapsedMs));
  const inputs=useRef([...initialInputs]);
  const [capped,setCapped]=useState(initialInputs.length>=MAX_INPUTS);
  const [initialState]=useState(()=>game.state());
  const state=useRef(initialState);
  const [hud,setHud]=useState(()=>hudValues(initialState));
  const publishedHud=useRef(hud);
  const lastHud=useRef(-Infinity), lastProgress=useRef(-Infinity);
  const [hidden,setHidden]=useState(false);
  const [nearMiss,setNearMiss]=useState(0);
  const [lost,setLost]=useState({key:0,level:1});
  const pendingNear=useRef(false);
  const [art,setArt]=useState<RunArt|null>(null);
  const canvas=useRef<HTMLCanvasElement>(null);
  const fps=useRef<HTMLOutputElement>(null);
  const wrapper=useRef<HTMLDivElement>(null);
  const active=useRef(false), reported=useRef(false), raf=useRef<number|null>(null);
  const crashFrame=useRef<number|null>(initialState.over?2:null);
  const surface=useRef<RunView|null>(null);
  const [webgl,setWebgl]=useState(false);
  const [viewReady,setViewReady]=useState(false);
  const draw=useCallback(()=>{
    surface.current?.draw(state.current,quiet,crashFrame.current);
  },[quiet]);
  const drawRef=useRef(draw);
  useEffect(()=>{drawRef.current=draw;draw();},[draw]);
  useEffect(()=>{
    let alive=true;
    void preloadRunArt().then(a=>{if(alive)setArt(a);});
    return ()=>{alive=false;};
  },[]);
  useEffect(()=>{
    const el=canvas.current;
    if(!el||!art)return;
    let alive=true,view:RunView|null=null;
    // Layout and backing-store allocation belong to resize, never the animation loop.
    const resize=()=>{
      const {width:w,height:h}=el.getBoundingClientRect();
      if(w<=0||h<=0||!view)return;
      view.resize(w,h,Math.min(2,window.devicePixelRatio||1));drawRef.current();
    };
    const observer=new ResizeObserver(resize);
    observer.observe(el);window.addEventListener('resize',resize);
    // Real 3D first (loaded on demand); the sprite renderers stay as fallbacks.
    void (async()=>{
      let made:RunView&{webgl:boolean};
      try{const {createRunThree}=await import('./runThree');made=await createRunThree(el);}
      catch{made=createRunView(el,art);}
      if(!alive){made.dispose();return;}
      view=made;surface.current=made;setWebgl(made.webgl);resize();setViewReady(true);
    })();
    return ()=>{alive=false;observer.disconnect();window.removeEventListener('resize',resize);surface.current=null;view?.dispose();setViewReady(false);};
  },[art]);
  const publish=useCallback((events:RunEvent[],force=false,render=true,snapshot?:RunState)=>{
    const s=snapshot??game.state();state.current=s;
    const now=performance.now();
    const terminal=s.over&&!reported.current;
    let progress:RunProgress|undefined;
    if(force||terminal||now-lastProgress.current>=1000) {
      lastProgress.current=now;
      progress={inputs:[...inputs.current],score:s.score,elapsedMs:s.tick*1000/60,endTick:s.tick,death:s.death?{...s.death}:null};
      onProgress(progress);
    }
    // Publish diagnostics at HUD cadence, flushing exact ticks on input/pause/hide/over.
    if(force||terminal||now-lastHud.current>=HUD_INTERVAL_MS) {
      const el=wrapper.current;
      if(el){el.dataset.lane=String(s.player.lane);el.dataset.state=s.over?'over':s.player.pose;el.dataset.tick=String(s.tick);el.dataset.phase=s.phase;}
    }
    if(terminal||now-lastHud.current>=HUD_INTERVAL_MS) {
      lastHud.current=now;
      const next=hudValues(s),previous=publishedHud.current;
      if(!sameHud(next,previous)) {
        // A combo that falls back to ×1 (miss or hit) shakes once where the chip was.
        if(next.comboLevel<previous.comboLevel&&previous.comboLevel>1)setLost(l=>({key:l.key+1,level:previous.comboLevel}));
        publishedHud.current=next;setHud(next);
      }
    }
    for(let i=0;i<events.length;i++)if(events[i].type==='collect'){if(soundOn)sound.merge(1);if(!quiet)haptic(8);break;}
    for(let i=0;i<events.length;i++)if(events[i].type==='near-miss')pendingNear.current=true;
    if(pendingNear.current){pendingNear.current=false;setNearMiss(n=>n+1);if(!quiet)haptic(6);}
    if(terminal) {
      reported.current=true;
      crashFrame.current=quiet?2:0;
      if(soundOn)sound.over();
      if(!quiet)haptic(24);
      onOver(progress!);
    }
    if(render)draw();
    return s.over;
  },[game,onProgress,onOver,soundOn,quiet,draw]);
  useEffect(()=>{
    const stop=()=>{
      active.current=false;
      if(raf.current!==null)cancelAnimationFrame(raf.current);raf.current=null;
      publish(game.step(elapsedTick(clock.pause(performance.now()))),true);
    };
    let frames=0,fpsStart=0,collected=false;
    const fpsEnabled=new URLSearchParams(window.location.search).get('fps')==='1';
    const fpsElement=fps.current;
    if(fpsElement)fpsElement.hidden=!fpsEnabled;
    const frame=(now:number)=>{
      if(!active.current)return;
      const snapshot=game.frame(elapsedTick(clock.read(now)));
      state.current=snapshot;
      for(let i=0;i<snapshot.events.length;i++){const type=snapshot.events[i].type;if(type==='collect')collected=true;else if(type==='near-miss')pendingNear.current=true;}
      if(snapshot.over)crashFrame.current=quiet?2:0;
      draw();
      if(fpsEnabled){frames++;if(!fpsStart)fpsStart=now;}
      if(!snapshot.over)raf.current=requestAnimationFrame(frame);
      else {active.current=false;raf.current=null;clock.pause(now);}
    };
    const start=()=>{
      if(!viewReady||paused||document.hidden||state.current.over||active.current)return;
      frames=0;fpsStart=0;active.current=true;clock.resume(performance.now());raf.current=requestAnimationFrame(frame);
    };
    const visibility=()=>{setHidden(document.hidden);if(document.hidden)stop();else start();};
    document.addEventListener('visibilitychange',visibility,true);
    window.addEventListener('pagehide',stop,true);
    const boot=setTimeout(()=>{publish(EMPTY_EVENTS,true);start();},0);
    // React, string formatting, persistence and DOM diagnostics stay out of rAF.
    const telemetry=setInterval(()=>{
      if(!active.current&&(!state.current.over||reported.current))return;
      if(collected){collected=false;if(soundOn)sound.merge(1);if(!quiet)haptic(8);}
      publish(EMPTY_EVENTS,false,false,state.current);
      const now=performance.now();
      if(fpsEnabled&&fpsElement&&fpsStart&&now-fpsStart>=1000){
        fpsElement.textContent=`${Math.round(frames*1000/(now-fpsStart))} ${t.fpsUnit} · ${surface.current&&'webgl' in surface.current&&surface.current.webgl?'GL':'2D'} · ${window.devicePixelRatio}x`;
        frames=0;fpsStart=now;
      }
    },HUD_INTERVAL_MS);
    return ()=>{
      clearTimeout(boot);clearInterval(telemetry);active.current=false;
      if(raf.current!==null)cancelAnimationFrame(raf.current);raf.current=null;
      publish(game.step(elapsedTick(clock.pause(performance.now()))),true,false);
      document.removeEventListener('visibilitychange',visibility,true);window.removeEventListener('pagehide',stop,true);
    };
  },[viewReady,clock,game,paused,publish,draw,soundOn,quiet]);
  // Three finite draws after collision, never an over-state rAF loop. Hiding cancels them.
  useEffect(()=>{
    if(!hud.over||hidden)return;
    // The crash settles in two shaky frames, then the hit obstacle keeps pulsing until the sheet opens.
    const timers=(quiet?[0]:[0,125,250,400,550,700,850]).map((delay,i)=>setTimeout(()=>{crashFrame.current=quiet?2:Math.min(i,2);draw();},delay));
    return ()=>timers.forEach(clearTimeout);
  },[hud.over,hidden,quiet,draw]);
  const swipe=useCallback((dir:RunDirection)=>{
    if(!active.current||paused||document.hidden||state.current.over)return;
    const tick=elapsedTick(clock.read(performance.now()));
    const events=game.step(tick);
    // Sprint ignores swipes, and S only means something in practice; neither is worth logging.
    const now=game.state();
    if(now.phase==='sprint'||(dir==='S'&&now.phase!=='practice')){publish(events,true,true,now);return;}
    if(!now.over&&inputs.current.length<MAX_INPUTS&&tick>(inputs.current.at(-1)?.tick??-1)) {
      events.push(...game.input(tick,dir));inputs.current.push({tick,dir});
      if(inputs.current.length===MAX_INPUTS)setCapped(true);
      if(soundOn)sound.drop();
    }
    publish(events,true);
  },[clock,game,paused,publish,soundOn]);
  useEffect(()=>{
    const el=wrapper.current;if(!el)return;
    let gesture:{id:number;x:number;y:number;done:boolean}|null=null;
    const start=(e:TouchEvent)=>{const touch=e.changedTouches[0];if(touch)gesture={id:touch.identifier,x:touch.clientX,y:touch.clientY,done:false};};
    const move=(e:TouchEvent)=>{
      if(!gesture)return;
      const touch=Array.from(e.changedTouches).find(t=>t.identifier===gesture!.id);if(!touch)return;
      e.preventDefault();if(gesture.done)return;
      const dir=swipeDirection(touch.clientX-gesture.x,touch.clientY-gesture.y);
      if(dir){gesture.done=true;swipe(dir);}
    };
    const end=()=>{gesture=null;};
    const key=(e:KeyboardEvent)=>{
      const dir=({ArrowLeft:'L',ArrowRight:'R',ArrowUp:'U',ArrowDown:'D'} as const)[e.key as 'ArrowLeft'];
      if(dir&&!e.repeat&&active.current){e.preventDefault();swipe(dir);}
    };
    el.addEventListener('touchstart',start,{passive:true});el.addEventListener('touchmove',move,{passive:false});
    el.addEventListener('touchend',end);el.addEventListener('touchcancel',end);window.addEventListener('keydown',key);
    return ()=>{el.removeEventListener('touchstart',start);el.removeEventListener('touchmove',move);el.removeEventListener('touchend',end);el.removeEventListener('touchcancel',end);window.removeEventListener('keydown',key);};
  },[swipe]);
  return <section className={`run-play${quiet?" run-quiet":""}`}>
    <div className="run-hud">
      <p className="run-chip"><span>{t.distance}</span><b className="font-num" data-testid="run-distance">{hud.distance}</b></p>
      <div className="run-powers">
        {hud.multiplier>1&&<span key={hud.multiplier} className="run-mult font-num" data-testid="run-multiplier">×{hud.multiplier}</span>}
        {hud.shield&&<img className="run-power-ico" src="/brand/art/shop/run-shield.webp" alt="" />}
        {hud.shoesTicks>0&&<span className="run-power-ico-wrap"><img className="run-power-ico" src="/brand/art/shop/run-shoes.webp" alt="" /><b className="font-num">{Math.ceil(hud.shoesTicks/60)}</b></span>}
        {([{name:'paper-bag',label:t.bag,ticks:hud.magnetTicks,total:MAGNET_TICKS},{name:'coffee-cup',label:t.coffee,ticks:hud.coffeeTicks,total:COFFEE_TICKS}] as const).filter(p=>p.ticks>0).map(p=><div key={p.name} className="run-power" role="img" aria-label={`${p.label} ${Math.ceil(p.ticks/60)}`}>
          <svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="20" pathLength="1" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={`${p.ticks/p.total} 1`} transform="rotate(-90 22 22)" /></svg>
          <RunSprite name={p.name} />
        </div>)}
      </div>
      <p className="run-chip run-chip-end"><span>{t.bread}</span><b className="font-num" data-testid="run-bread">{hud.bread}</b></p>
      {hud.comboLevel>1?<div key={`c${hud.comboLevel}`} className={`run-combo font-num${hud.grace?"":" run-combo-thin"}`} role="img" aria-label={`${t.combo} ×${hud.comboLevel}`} data-testid="run-combo" data-level={hud.comboLevel} data-grace={hud.grace?"1":"0"}>
        <i aria-hidden="true" /><span className="run-combo-label">{t.combo}</span>×{hud.comboLevel}
      </div>:lost.key>0&&<div key={`l${lost.key}`} className="run-combo run-combo-lost font-num" aria-hidden="true" data-testid="run-combo-lost">×{lost.level}</div>}
    </div>
    {hud.phase==='sprint'&&<div className="run-tag" data-testid="run-sprint"><b className="font-display">{t.sprintOn}</b><i style={{width:`${hud.sprintPct}%`}} /></div>}
    {hud.phase==='practice'&&<div className="run-tag run-tag-practice" data-testid="run-practice"><b className="font-display">{t.practice}</b></div>}
    {hud.takeover>0&&<p key={hud.takeover} className="run-takeover font-display" role="status" data-testid="run-takeover">{t.takeover}<b className="font-num">{hud.takeover}</b></p>}
    {hud.cue>0&&!hud.over&&<p key={`q${hud.cue}`} className="run-cue font-display" role="status" data-testid="run-cue" data-cue={hud.cue}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d={CUE_ICON[hud.cue as 1|2|3]} /></svg>
      {hud.cue===1?t.cueLane:hud.cue===2?t.cueJump:t.cueSlide}
    </p>}
    {hud.phase==='practice'&&!hud.over&&<button type="button" className="run-skip font-display" onClick={()=>swipe('S')} data-testid="run-skip">{t.practiceSkip}</button>}
    <div ref={wrapper} className={`run-board${webgl?" run-board-gl":""}${hud.coffeeTicks>0?" run-board-rush":hud.phase==='sprint'?" run-board-sprint":hud.fast?" run-board-fast":""}`} style={{"--lane":hud.lane} as CSSProperties} role="application" aria-label={t.boardLabel} tabIndex={0} onClick={()=>{if(state.current.over)onShowResult?.();}} data-testid="run-board" >
      <canvas ref={canvas} aria-hidden="true" />
      {nearMiss>0&&<span key={nearMiss} className="run-near font-display" aria-hidden="true" data-testid="run-near-miss">{t.nearMiss}</span>}
      <output ref={fps} hidden className="run-fps" aria-hidden="true" />
      {!viewReady&&<p className="run-overlay" role="status">{t.loading}</p>}
      {capped&&!hud.over&&<p className="run-input-limit" role="status">{t.inputLimit}</p>}
      {(paused||hidden)&&!hud.over&&<p className="run-overlay" role="status">{t.paused}</p>}
    </div>
  </section>;
}

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRunGame, MAX_INPUTS, MAGNET_TICKS, COFFEE_TICKS, type RunInput, type RunDirection, type RunEvent, type RunState } from "@/lib/run";
import { copy } from "@/copy";
import { sound } from "@/components/game/sound";
import { haptic, useMotionPrefs } from "@/lib/motion/react";
import { createRunClock, elapsedTick } from "./runClock";
import { preloadRunArt, type RunArt } from "./runAssets";
import { renderRun } from "./runRenderer";
import { swipeDirection } from "./runHelpers";
import { RunSprite } from "./RunArt";

export interface RunProgress { inputs: RunInput[]; score: number; elapsedMs: number; endTick: number }
interface Props {
  seed: string; initialInputs?: RunInput[]; initialElapsedMs?: number;
  soundOn: boolean; reduced: boolean; paused: boolean;
  onProgress: (p: RunProgress) => void; onOver: (p: RunProgress) => void; onShowResult?: () => void;
}
const t=copy.customer.run;
const HUD_INTERVAL_MS = 100;
const hudValues = (s: RunState) => ({
  distance: Math.floor(s.distance/1000), bread: s.bread, over: s.over,
  magnetTicks: s.powerUps.magnetTicks, coffeeTicks: s.powerUps.coffeeTicks,
});
export function RunBoard({seed,initialInputs=[],initialElapsedMs=0,soundOn,reduced,paused,onProgress,onOver,onShowResult}:Props) {
  const {degraded}=useMotionPrefs();
  const quiet=reduced||degraded;
  const [game]=useState(()=>{
    const g=createRunGame({seed});
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
  const [art,setArt]=useState<RunArt|null>(null);
  const canvas=useRef<HTMLCanvasElement>(null);
  const wrapper=useRef<HTMLDivElement>(null);
  const active=useRef(false), reported=useRef(false), raf=useRef<number|null>(null);
  const crashFrame=useRef<number|null>(initialState.over?2:null);
  const surface=useRef<{ctx:CanvasRenderingContext2D;w:number;h:number}|null>(null);
  const draw=useCallback(()=>{
    const target=surface.current;
    if(!target||!art)return;
    renderRun(target.ctx,art,state.current,target.w,target.h,quiet,crashFrame.current);
  },[art,quiet]);
  useEffect(()=>{
    let alive=true;
    void preloadRunArt().then(a=>{if(alive)setArt(a);});
    return ()=>{alive=false;};
  },[]);
  useEffect(()=>{
    const el=canvas.current;
    if(!el)return;
    // Layout and backing-store allocation belong to resize, never the animation loop.
    const resize=()=>{
      const {width:w,height:h}=el.getBoundingClientRect();
      if(w<=0||h<=0){surface.current=null;return;}
      const dpr=window.devicePixelRatio||1;
      const width=Math.round(w*dpr),height=Math.round(h*dpr);
      if(el.width!==width||el.height!==height){el.width=width;el.height=height;}
      const ctx=el.getContext('2d');if(!ctx)return;
      ctx.setTransform(width/w,0,0,height/h,0,0);
      surface.current={ctx,w,h};draw();
    };
    const observer=new ResizeObserver(resize);
    observer.observe(el);window.addEventListener('resize',resize);
    resize();
    return ()=>{observer.disconnect();window.removeEventListener('resize',resize);};
  },[draw]);
  const publish=useCallback((events:RunEvent[],force=false,render=true)=>{
    const s=game.state();state.current=s;
    const now=performance.now();
    const terminal=s.over&&!reported.current;
    let progress:RunProgress|undefined;
    if(force||terminal||now-lastProgress.current>=HUD_INTERVAL_MS) {
      lastProgress.current=now;
      progress={inputs:[...inputs.current],score:s.score,elapsedMs:s.tick*1000/60,endTick:s.tick};
      onProgress(progress);
    }
    if(!render)return s.over;
    // Publish diagnostics at HUD cadence, flushing exact ticks on input/pause/hide/over.
    if(force||terminal||now-lastHud.current>=HUD_INTERVAL_MS) {
      const el=wrapper.current;
      if(el){el.dataset.lane=String(s.player.lane);el.dataset.state=s.over?'over':s.player.pose;el.dataset.tick=String(s.tick);}
    }
    if(terminal||now-lastHud.current>=HUD_INTERVAL_MS) {
      lastHud.current=now;
      const next=hudValues(s),previous=publishedHud.current;
      if(next.distance!==previous.distance||next.bread!==previous.bread||next.over!==previous.over||
        next.magnetTicks!==previous.magnetTicks||next.coffeeTicks!==previous.coffeeTicks) {
        publishedHud.current=next;setHud(next);
      }
    }
    if(events.some(e=>e.type==='collect')) {if(soundOn)sound.merge(1);if(!quiet)haptic(8);}
    if(terminal) {
      reported.current=true;
      crashFrame.current=quiet?2:0;
      if(soundOn)sound.over();
      if(!quiet)haptic(24);
      onOver(progress!);
    }
    draw();
    return s.over;
  },[game,onProgress,onOver,soundOn,quiet,draw]);
  useEffect(()=>{
    const stop=()=>{
      active.current=false;
      if(raf.current!==null)cancelAnimationFrame(raf.current);raf.current=null;
      publish(game.step(elapsedTick(clock.pause(performance.now()))),true);
    };
    const frame=()=>{
      if(!active.current)return;
      const over=publish(game.step(elapsedTick(clock.read(performance.now()))));
      if(!over)raf.current=requestAnimationFrame(frame);
      else {active.current=false;raf.current=null;clock.pause(performance.now());}
    };
    const start=()=>{
      if(!art||paused||document.hidden||state.current.over||active.current)return;
      active.current=true;clock.resume(performance.now());raf.current=requestAnimationFrame(frame);
    };
    const visibility=()=>{setHidden(document.hidden);if(document.hidden)stop();else start();};
    document.addEventListener('visibilitychange',visibility,true);
    window.addEventListener('pagehide',stop,true);
    const boot=setTimeout(()=>{publish([],true);start();},0);
    return ()=>{
      clearTimeout(boot);active.current=false;
      if(raf.current!==null)cancelAnimationFrame(raf.current);raf.current=null;
      publish(game.step(elapsedTick(clock.pause(performance.now()))),true,false);
      document.removeEventListener('visibilitychange',visibility,true);window.removeEventListener('pagehide',stop,true);
    };
  },[art,clock,game,paused,publish]);
  // Three finite draws after collision, never an over-state rAF loop. Hiding cancels them.
  useEffect(()=>{
    if(!hud.over||hidden)return;
    const timers=(quiet?[0]:[0,125,250]).map((delay,i)=>setTimeout(()=>{crashFrame.current=quiet?2:i;draw();},delay));
    return ()=>timers.forEach(clearTimeout);
  },[hud.over,hidden,quiet,draw]);
  const swipe=useCallback((dir:RunDirection)=>{
    if(!active.current||paused||document.hidden||state.current.over)return;
    const tick=elapsedTick(clock.read(performance.now()));
    const events=game.step(tick);
    if(!game.state().over&&inputs.current.length<MAX_INPUTS&&tick>(inputs.current.at(-1)?.tick??-1)) {
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
  return <section className="run-play">
    <div className="run-hud">
      <p>{t.distance}<b className="font-num" data-testid="run-distance">{hud.distance}</b></p>
      <div className="run-powers">
        {([{name:'paper-bag',label:t.bag,ticks:hud.magnetTicks,total:MAGNET_TICKS},{name:'coffee-cup',label:t.coffee,ticks:hud.coffeeTicks,total:COFFEE_TICKS}] as const).filter(p=>p.ticks>0).map(p=><div key={p.name} className="run-power" role="img" aria-label={`${p.label} ${Math.ceil(p.ticks/60)}`}>
          <svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="20" pathLength="1" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={`${p.ticks/p.total} 1`} transform="rotate(-90 22 22)" /></svg>
          <RunSprite name={p.name} />
        </div>)}
      </div>
      <p>{t.bread}<b className="font-num" data-testid="run-bread">{hud.bread}</b></p>
    </div>
    <div ref={wrapper} className="run-board" role="application" aria-label={t.boardLabel} tabIndex={0} onClick={()=>{if(state.current.over)onShowResult?.();}} data-testid="run-board" >
      <canvas ref={canvas} aria-hidden="true" />
      {!art&&<p className="run-overlay" role="status">{t.loading}</p>}
      {capped&&!hud.over&&<p className="run-input-limit" role="status">{t.inputLimit}</p>}
      {(paused||hidden)&&!hud.over&&<p className="run-overlay" role="status">{t.paused}</p>}
    </div>
  </section>;
}

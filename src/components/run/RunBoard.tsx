"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRunGame, MAX_INPUTS, MAGNET_TICKS, COFFEE_TICKS, type RunInput, type RunDirection, type RunEvent } from "@/lib/run";
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
  const [snap,setSnap]=useState(()=>game.state());
  const [hidden,setHidden]=useState(false);
  const [art,setArt]=useState<RunArt|null>(null);
  const canvas=useRef<HTMLCanvasElement>(null);
  const wrapper=useRef<HTMLDivElement>(null);
  const active=useRef(false), reported=useRef(false), raf=useRef<number|null>(null);
  const crashFrame=useRef<number|null>(snap.over?2:null);
  const draw=useCallback(()=>{
    const el=canvas.current;
    if(!el||!art) return;
    const {width:w,height:h}=el.getBoundingClientRect();
    const dpr=Math.min(2,window.devicePixelRatio||1);
    if(el.width!==Math.round(w*dpr)||el.height!==Math.round(h*dpr)) {el.width=Math.round(w*dpr);el.height=Math.round(h*dpr);}
    const ctx=el.getContext('2d');if(!ctx) return;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    renderRun(ctx,art,game.state(),w,h,quiet,crashFrame.current);
  },[art,game,quiet]);
  useEffect(()=>{
    let alive=true;
    void preloadRunArt().then(a=>{if(alive)setArt(a);});
    return ()=>{alive=false;};
  },[]);
  useEffect(()=>{
    const observer=new ResizeObserver(()=>draw());
    if(canvas.current)observer.observe(canvas.current);
    draw();return ()=>observer.disconnect();
  },[draw]);
  const publish=useCallback((events:RunEvent[],render=true)=>{
    const s=game.state();
    const progress={inputs:[...inputs.current],score:s.score,elapsedMs:s.tick*1000/60,endTick:s.tick};
    onProgress(progress);
    if(!render)return;
    setSnap(s);
    if(events.some(e=>e.type==='collect')) {if(soundOn)sound.merge(1);if(!quiet)haptic(8);}
    if(s.over&&!reported.current) {
      reported.current=true;
      crashFrame.current=quiet?2:0;
      if(soundOn)sound.over();
      if(!quiet)haptic(24);
      onOver(progress);
    }
    draw();
  },[game,onProgress,onOver,soundOn,quiet,draw]);
  useEffect(()=>{
    const stop=()=>{
      active.current=false;
      if(raf.current!==null)cancelAnimationFrame(raf.current);raf.current=null;
      publish(game.step(elapsedTick(clock.pause(performance.now()))));
    };
    const frame=()=>{
      if(!active.current)return;
      publish(game.step(elapsedTick(clock.read(performance.now()))));
      if(!game.state().over)raf.current=requestAnimationFrame(frame);
      else {active.current=false;raf.current=null;clock.pause(performance.now());}
    };
    const start=()=>{
      if(!art||paused||document.hidden||game.state().over||active.current)return;
      active.current=true;clock.resume(performance.now());raf.current=requestAnimationFrame(frame);
    };
    const visibility=()=>{setHidden(document.hidden);if(document.hidden)stop();else start();};
    document.addEventListener('visibilitychange',visibility,true);
    window.addEventListener('pagehide',stop,true);
    const boot=setTimeout(()=>{publish([]);start();},0);
    return ()=>{
      clearTimeout(boot);active.current=false;
      if(raf.current!==null)cancelAnimationFrame(raf.current);raf.current=null;
      publish(game.step(elapsedTick(clock.pause(performance.now()))),false);
      document.removeEventListener('visibilitychange',visibility,true);window.removeEventListener('pagehide',stop,true);
    };
  },[art,clock,game,paused,publish]);
  // Three finite draws after collision, never an over-state rAF loop. Hiding cancels them.
  useEffect(()=>{
    if(!snap.over||hidden)return;
    const timers=(quiet?[0]:[0,125,250]).map((delay,i)=>setTimeout(()=>{crashFrame.current=quiet?2:i;draw();},delay));
    return ()=>timers.forEach(clearTimeout);
  },[snap.over,hidden,quiet,draw]);
  const swipe=useCallback((dir:RunDirection)=>{
    if(!active.current||paused||document.hidden||game.state().over)return;
    const tick=elapsedTick(clock.read(performance.now()));
    const events=game.step(tick);
    if(!game.state().over&&inputs.current.length<MAX_INPUTS&&tick>(inputs.current.at(-1)?.tick??-1)) {
      events.push(...game.input(tick,dir));inputs.current.push({tick,dir});
      if(inputs.current.length===MAX_INPUTS)setCapped(true);
      if(soundOn)sound.drop();
    }
    publish(events);
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
      <p>{t.distance}<b className="font-num" data-testid="run-distance">{Math.floor(snap.distance/1000)}</b></p>
      <div className="run-powers">
        {([{name:'paper-bag',label:t.bag,ticks:snap.powerUps.magnetTicks,total:MAGNET_TICKS},{name:'coffee-cup',label:t.coffee,ticks:snap.powerUps.coffeeTicks,total:COFFEE_TICKS}] as const).filter(p=>p.ticks>0).map(p=><div key={p.name} className="run-power" role="img" aria-label={`${p.label} ${Math.ceil(p.ticks/60)}`}>
          <svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="20" pathLength="1" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={`${p.ticks/p.total} 1`} transform="rotate(-90 22 22)" /></svg>
          <RunSprite name={p.name} />
        </div>)}
      </div>
      <p>{t.bread}<b className="font-num" data-testid="run-bread">{snap.bread}</b></p>
    </div>
    <div ref={wrapper} className="run-board" role="application" aria-label={t.boardLabel} tabIndex={0} onClick={()=>{if(snap.over)onShowResult?.();}} data-testid="run-board" data-lane={snap.player.lane} data-state={snap.over?'over':snap.player.pose} data-tick={snap.tick}>
      <canvas ref={canvas} aria-hidden="true" />
      {!art&&<p className="run-overlay" role="status">{t.loading}</p>}
      {capped&&!snap.over&&<p className="run-input-limit" role="status">{t.inputLimit}</p>}
      {(paused||hidden)&&!snap.over&&<p className="run-overlay" role="status">{t.paused}</p>}
    </div>
  </section>;
}

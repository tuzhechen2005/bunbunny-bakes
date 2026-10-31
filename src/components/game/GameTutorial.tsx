"use client";
/* eslint-disable @next/next/no-img-element -- Static brand art. */
import { useEffect, useState, type ReactNode } from "react";
import { copy } from "@/copy";
import { fill } from "@/components/customer/format";
import { focusRing } from "@/components/ui/focus";
import "./tutorial.css";

export type TutorialGame = "big" | "tu" | "m3" | "grab" | "run" | "td";
const t = copy.customer.tutorial;
const KEY = (g: TutorialGame) => `bb_tutorial_${g}_v1`;

const Img = ({ src, className = "" }: { src: string; className?: string }) => <img src={src} alt="" draggable={false} className={className} />;
const Tap = ({ className = "" }: { className?: string }) => <span className={`tut-tap ${className}`} aria-hidden="true" />;
const Swipe = ({ dir }: { dir: "x" | "up" | "down" }) => <span className={`tut-swipe tut-swipe-${dir}`} aria-hidden="true" />;
const Tile = ({ tone, className = "" }: { tone: number; className?: string }) =>
  <span className={`tut-tile tut-tone-${tone} ${className}`}><Img src="/brand/grab/bread.svg" /></span>;

/** One small animated scene per step. All motion is CSS and stops under reduced motion. */
const SCENES: Record<TutorialGame, ReactNode[]> = {
  big: [
    <><Img src="/brand/grab/bread.svg" className="tut-fall" /><Tap className="tut-at-top" /><span className="tut-floor" /></>,
    <><Img src="/brand/grab/bread.svg" className="tut-merge-l" /><Img src="/brand/grab/bread.svg" className="tut-merge-r" /><Img src="/brand/grab/bread.svg" className="tut-merge-big" /></>,
    <><span className="tut-topline" /><span className="tut-pile">{[0, 1, 2, 3, 4].map(i => <Img key={i} src="/brand/grab/bread.svg" />)}</span></>,
  ],
  tu: [
    <><span className="tut-stack"><Tile tone={1} /><Tile tone={2} className="tut-under" /></span><Tap className="tut-at-stack" /><Img src="/brand/bag.webp" className="tut-bag" /></>,
    <><span className="tut-row"><Tile tone={1} className="tut-pack" /><Tile tone={1} className="tut-pack" /><Tile tone={1} className="tut-pack" /></span><Img src="/brand/bag.webp" className="tut-bag" /></>,
    <><span className="tut-order"><Tile tone={3} /><b>×3</b><i>+</i></span></>,
  ],
  m3: [
    <><span className="tut-grid"><Tile tone={1} /><Tile tone={2} className="tut-swap-a" /><Tile tone={1} className="tut-swap-b" /><Tile tone={1} /></span><Swipe dir="x" /></>,
    <><Img src="/brand/m3/roll.svg" className="tut-hop" /><Img src="/brand/m3/big.svg" className="tut-hop tut-late" /></>,
    <><span className="tut-meter"><i /></span><b className="tut-count font-num">9</b></>,
  ],
  grab: [
    <><Img src="/brand/grab/bunny.svg" className="tut-bunny" /><span className="tut-arm"><Img src="/brand/grab/tongs.svg" /></span><Tap className="tut-at-bottom" /></>,
    <><span className="tut-row"><Tile tone={4} className="tut-raw" /><Tile tone={1} className="tut-gold" /><Tile tone={5} className="tut-burnt" /></span></>,
    <><Img src="/brand/grab/flour.svg" className="tut-heavy" /><Img src="/brand/grab/clock.svg" className="tut-hop" /></>,
  ],
  run: [
    <><span className="tut-lanes" /><Img src="/brand/run.svg" className="tut-runner tut-lane-move" /><Swipe dir="x" /></>,
    <><span className="tut-lanes" /><Img src="/brand/run.svg" className="tut-runner tut-jump" /><span className="tut-sack" /><Swipe dir="up" /></>,
    <><span className="tut-ramp" /><Img src="/brand/run.svg" className="tut-runner tut-climb" /></>,
    <><span className="tut-row"><Img src="/brand/run/paper-bag.webp" className="tut-power tut-glow" /><Img src="/brand/run/coffee-cup.webp" className="tut-power tut-glow tut-late" /></span></>,
  ],
  td: [
    <><span className="tut-row">{["pin", "whisk", "sifter", "oven"].map((k, i) => <Img key={k} src={`/brand/td/tower-${k}-0.webp`} className={`tut-tower tut-pop-in tut-d${i}`} />)}</span></>,
    <><span className="tut-path" /><span className="tut-thief"><span className="td-pest-icon td-pest-mouse" /><Tile tone={1} className="tut-carried" /></span></>,
    <><Img src="/brand/td/tower-pin-1.webp" className="tut-tower" /><span className="tut-branches"><b>A</b><b>B</b></span></>,
    <><span className="tut-row"><b className="tut-chip">1×</b><b className="tut-chip tut-on">2×</b><b className="tut-chip">3×</b></span></>,
  ],
};

function seen(game: TutorialGame) {
  try { return localStorage.getItem(KEY(game)) === "1"; } catch { return true; }
}

/** Opens once automatically (not under automation), and from the menu link any time. */
export function GameTutorial({ game }: { game: TutorialGame }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  useEffect(() => {
    const automated = typeof navigator !== "undefined" && navigator.webdriver && !location.search.includes("tutorial=1");
    if (automated || seen(game)) return;
    // After hydration: storage is client-only.
    const id = setTimeout(() => { setStep(0); setOpen(true); }, 0);
    return () => clearTimeout(id);
  }, [game]);
  const steps = t[game];
  const finish = () => { try { localStorage.setItem(KEY(game), "1"); } catch { /* private mode */ } setOpen(false); };
  return <>
    <button type="button" className={`tut-open ${focusRing}`} data-testid={`${game}-tutorial-open`} onClick={() => { setStep(0); setOpen(true); }}>{t.open}</button>
    {open && <div className="tut-backdrop" role="dialog" aria-modal="true" aria-label={t.open} data-testid={`${game}-tutorial`}>
      <div className="tut-card">
        <button type="button" className={`tut-skip ${focusRing}`} onClick={finish} data-testid="tutorial-skip">{t.skip}</button>
        <div key={step} className="tut-stage" aria-hidden="true">{SCENES[game][step]}</div>
        <p className="tut-step font-num">{fill(t.step, { n: String(step + 1), total: String(steps.length) })}</p>
        <h2 className="font-display">{steps[step].title}</h2>
        <p className="tut-text">{steps[step].text}</p>
        <div className="tut-dots" aria-hidden="true">{steps.map((_, i) => <i key={i} className={i === step ? "on" : ""} />)}</div>
        <button type="button" className={`tut-next font-display ${focusRing}`} data-testid="tutorial-next"
          onClick={() => step + 1 < steps.length ? setStep(step + 1) : finish()}>{step + 1 < steps.length ? t.next : t.go}</button>
      </div>
    </div>}
  </>;
}

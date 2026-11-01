"use client";
// Per-game background music: one decoded buffer per game, looped gaplessly through Web Audio,
// faded in/out, and only while the game is on screen with sound on.
import { useEffect } from "react";
import { audioContext } from "./sound";

export type BgmGame = "big" | "tu" | "m3" | "grab" | "run" | "td";
const VOLUME = 0.32;
const buffers = new Map<BgmGame, Promise<AudioBuffer | null>>();
let source: AudioBufferSourceNode | null = null, gain: GainNode | null = null, current: BgmGame | null = null;

function load(c: AudioContext, game: BgmGame): Promise<AudioBuffer | null> {
  let p = buffers.get(game);
  if (!p) {
    p = (async () => {
      for (const ext of ["m4a", "ogg"]) {
        try {
          const res = await fetch(`/audio/bgm/${game}.${ext}`);
          if (!res.ok) continue;
          return await c.decodeAudioData(await res.arrayBuffer());
        } catch { /* try the next format */ }
      }
      return null;
    })();
    buffers.set(game, p);
  }
  return p;
}

export async function startBgm(game: BgmGame) {
  if (current === game && source) return;
  stopBgm(0.2);
  current = game;
  const c = audioContext();
  if (!c) return;
  const buf = await load(c, game);
  if (current !== game || !buf || source) return;
  gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(VOLUME, c.currentTime + 1.2);
  source = c.createBufferSource(); source.buffer = buf; source.loop = true;
  source.connect(gain).connect(c.destination); source.start();
}

export function stopBgm(fade = 0.5) {
  const c = audioContext(), s = source, g = gain;
  source = null; gain = null; current = null;
  if (!c || !s || !g) return;
  const now = c.currentTime;
  g.gain.cancelScheduledValues(now); g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + fade);
  s.stop(now + fade + 0.05);
}

/** Plays `game`'s track while `on`; pauses when the tab hides. */
export function useBgm(game: BgmGame, on: boolean) {
  useEffect(() => {
    if (!on) { stopBgm(); return; }
    void startBgm(game);
    const visibility = () => { if (document.hidden) stopBgm(0.1); else void startBgm(game); };
    document.addEventListener("visibilitychange", visibility);
    return () => { document.removeEventListener("visibilitychange", visibility); stopBgm(); };
  }, [game, on]);
}

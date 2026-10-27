// Synthesised game sounds (D105): Web Audio only, no files. Off by default; the context is created
// lazily on the first sound after a user gesture, so nothing runs while the toggle is off.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

/** Pentatonic steps (semitones from C5) so rising merges always sound pleasant. */
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

function ensure(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}

/** Call from a tap / click so iOS lets the context start. */
export function unlockAudio(): void {
  ensure();
}

const freq = (semi: number) => 523.25 * Math.pow(2, semi / 12);

function tone(type: OscillatorType, f: number, start: number, dur: number, peak: number, slideTo?: number) {
  const c = ctx;
  if (!c || !master) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, start);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(peak, start + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(master);
  o.start(start);
  o.stop(start + dur + 0.02);
}

export const sound = {
  drop() {
    const c = ensure();
    if (!c) return;
    tone("triangle", 420, c.currentTime, 0.07, 0.25, 260);
  },
  merge(tier: number) {
    const c = ensure();
    if (!c) return;
    const f = freq(SCALE[Math.min(tier, SCALE.length - 1)] - 5);
    const t = c.currentTime;
    tone("sine", f, t, 0.22, 0.4, f * 1.5);
    tone("triangle", f * 2, t + 0.02, 0.12, 0.15);
  },
  big() {
    const c = ensure();
    if (!c) return;
    const t = c.currentTime;
    [0, 4, 7, 12, 16].forEach((s, i) => tone("sine", freq(s - 12), t + i * 0.06, 0.9, 0.28));
    tone("triangle", freq(0), t + 0.3, 1.1, 0.2);
  },
  /** D109 big + big: a rising fanfare, a bright chord and a falling sparkle. Only the biggest moment gets it. */
  bigBig() {
    const c = ensure();
    if (!c) return;
    const t = c.currentTime;
    [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => tone("triangle", freq(s - 12), t + i * 0.05, 0.5, 0.26));
    [12, 16, 19, 24].forEach((s) => tone("sine", freq(s), t + 0.38, 1.3, 0.22));
    tone("sine", freq(28), t + 0.4, 0.9, 0.12, freq(16));
  },
  over() {
    const c = ensure();
    if (!c) return;
    const t = c.currentTime;
    tone("sawtooth", freq(-5), t, 0.5, 0.18, freq(-17));
    tone("sine", freq(-12), t + 0.15, 0.7, 0.25, freq(-24));
  },
};

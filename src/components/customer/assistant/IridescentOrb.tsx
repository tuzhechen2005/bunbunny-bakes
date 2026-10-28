"use client";

// The 小小🐰 entry orb: adapted from "Iridescent Flow" in VoiceOrbs
// (https://github.com/amunozdev/voiceorbs), MIT License, Copyright (c) 2026 Alexis Munoz.
// Trimmed to the idle state. The one exception to the no-WebGL rule (D119): it animates only while
// the orb is on screen and the page is visible, draws one still frame under reduced motion or
// degraded motion, and falls back to the CSS GlassOrb when WebGL is missing or the context is lost.

import { useEffect, useRef, useState } from "react";
import { useMotionPrefs } from "@/lib/motion/react";
import { GlassOrb } from "./GlassOrb";

/** Flow speed: about 4x the original idle so the orb visibly moves (D120); faster while thinking. */
const FLOW_RATE = 0.9;
const THINK_RATE = 2.2;
/** How fast the thinking look fades in and out (per second). */
const THINK_EASE = 4;
/** Start a little into the noise so the first still frame is not flat. */
const TIME_OFFSET = 4.7;
/** Pink-violet → cyan (the original's defaults), as 0..1 RGB. */
const COLOR_FROM = [192 / 255, 132 / 255, 252 / 255];
const COLOR_TO = [103 / 255, 232 / 255, 249 / 255];

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform float uSize;
uniform float uFlow;
uniform float uTime;
uniform float uThink;
uniform vec3 uColorFrom;
uniform vec3 uColorTo;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.55;
  for (int i = 0; i < 3; i++) {
    v += amp * noise(p);
    p = p * 2.03 + vec2(11.7, 5.3);
    amp *= 0.5;
  }
  return v;
}

void main() {
  vec2 p = (gl_FragCoord.xy * 2.0 - uSize) / uSize;
  float r = length(p);
  float mask = 1.0 - smoothstep(0.86, 0.92, r);
  if (mask < 0.003) { gl_FragColor = vec4(0.0); return; }

  vec2 drift = vec2(uFlow * 0.32, -uFlow * 0.21);
  vec2 q = vec2(fbm(p * 2.1 + drift), fbm(p * 2.1 + drift.yx + vec2(4.7, 1.9)));
  float n = fbm(p * 2.6 + 2.2 * q + vec2(uFlow * 0.42, uFlow * 0.27));
  // Thinking (the original's "thinking" state): interference rings travelling through the orb.
  float inter = sin(r * 24.0 - uTime * 3.1) * sin(r * 15.0 + uTime * 2.3);
  n = clamp(n + uThink * inter * 0.2, 0.0, 1.0);

  float fres = pow(smoothstep(0.3, 0.9, r), 2.0);
  float th = n * 1.7 + fres * 1.15 + uFlow * 0.1;
  vec3 film = 0.5 + 0.5 * cos(6.28318 * (th + vec3(0.0, 0.33, 0.67)));

  vec3 base = mix(uColorFrom, uColorTo, smoothstep(0.15, 0.85, n));
  vec3 col = base * (0.62 + 0.85 * n);
  col += mix(uColorFrom, uColorTo, 0.5) * (1.0 - smoothstep(0.05, 0.75, r)) * 0.3;
  col += film * 0.4 * (0.35 + 0.65 * fres);
  col += mix(uColorTo, vec3(1.0), 0.45) * pow(smoothstep(0.55, 0.9, r), 3.0) * 0.4;
  col *= 0.9 + uThink * (0.12 * sin(uTime * 4.2) + 0.1 * inter);
  col = clamp(col / (1.0 + 0.22 * col), 0.0, 1.0);
  gl_FragColor = vec4(col * mask, mask);
}
`;

export interface IridescentOrbProps {
  /** CSS px. */
  size?: number;
  /** Waiting for a reply: faster flow plus travelling rings. */
  thinking?: boolean;
}

export function IridescentOrb({ size = 72, thinking = false }: IridescentOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const { reduced, degraded } = useMotionPrefs();
  const still = reduced || degraded;
  const thinkingRef = useRef(thinking);
  useEffect(() => {
    thinkingRef.current = thinking;
  }, [thinking]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || failed) return;
    let gl: WebGLRenderingContext | null = null;
    try {
      gl = canvas.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: "low-power" });
    } catch {
      gl = null;
    }
    if (!gl) {
      setFailed(true);
      return;
    }
    const g = gl;
    const compile = (type: number, src: string) => {
      const sh = g.createShader(type);
      if (!sh) return null;
      g.shaderSource(sh, src);
      g.compileShader(sh);
      return g.getShaderParameter(sh, g.COMPILE_STATUS) ? sh : null;
    };
    const vert = compile(g.VERTEX_SHADER, VERT);
    const frag = compile(g.FRAGMENT_SHADER, FRAG);
    const program = g.createProgram();
    if (!vert || !frag || !program) {
      setFailed(true);
      return;
    }
    g.attachShader(program, vert);
    g.attachShader(program, frag);
    g.linkProgram(program);
    if (!g.getProgramParameter(program, g.LINK_STATUS)) {
      setFailed(true);
      return;
    }
    g.useProgram(program);
    const buffer = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, buffer);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
    const aPos = g.getAttribLocation(program, "aPos");
    g.enableVertexAttribArray(aPos);
    g.vertexAttribPointer(aPos, 2, g.FLOAT, false, 0, 0);

    const px = Math.round(size * Math.min(window.devicePixelRatio || 1, 2));
    canvas.width = px;
    canvas.height = px;
    g.viewport(0, 0, px, px);
    g.uniform1f(g.getUniformLocation(program, "uSize"), px);
    g.uniform3fv(g.getUniformLocation(program, "uColorFrom"), COLOR_FROM);
    g.uniform3fv(g.getUniformLocation(program, "uColorTo"), COLOR_TO);
    const uFlow = g.getUniformLocation(program, "uFlow");
    const uTime = g.getUniformLocation(program, "uTime");
    const uThink = g.getUniformLocation(program, "uThink");

    let flow = TIME_OFFSET * FLOW_RATE;
    let time = TIME_OFFSET;
    let think = still && thinkingRef.current ? 1 : 0;
    const draw = () => {
      g.uniform1f(uFlow, flow);
      g.uniform1f(uTime, time);
      g.uniform1f(uThink, think);
      g.drawArrays(g.TRIANGLES, 0, 3);
    };
    draw();

    // Animate only while on screen and the tab is visible; under reduced/degraded motion keep the still frame.
    let raf = 0;
    let last = 0;
    let onScreen = false;
    const tick = (now: number) => {
      if (last) {
        const dt = Math.min(0.1, (now - last) / 1000);
        const target = thinkingRef.current ? 1 : 0;
        think += Math.sign(target - think) * Math.min(Math.abs(target - think), dt * THINK_EASE);
        flow += dt * (FLOW_RATE + (THINK_RATE - FLOW_RATE) * think);
        time += dt;
      }
      last = now;
      draw();
      raf = requestAnimationFrame(tick);
    };
    const update = () => {
      const run = !still && onScreen && document.visibilityState === "visible";
      if (run && !raf) {
        last = 0;
        raf = requestAnimationFrame(tick);
      } else if (!run && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    const io = new IntersectionObserver((entries) => {
      onScreen = entries.some((e) => e.isIntersecting);
      update();
    });
    io.observe(canvas);
    document.addEventListener("visibilitychange", update);
    const onLost = (e: Event) => {
      e.preventDefault();
      setFailed(true);
    };
    canvas.addEventListener("webglcontextlost", onLost);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", update);
      canvas.removeEventListener("webglcontextlost", onLost);
      g.deleteBuffer(buffer);
      g.deleteProgram(program);
      g.deleteShader(vert);
      g.deleteShader(frag);
    };
  }, [failed, still, size]);

  if (failed) return <GlassOrb size={size} />;
  return (
    <span className="ao-iris" style={{ width: size, height: size }} aria-hidden="true">
      <canvas ref={canvasRef} className="ao-iris-canvas" />
    </span>
  );
}

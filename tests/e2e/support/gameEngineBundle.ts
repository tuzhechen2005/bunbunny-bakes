// Builds a self-contained JavaScript string of the game engine (src/lib/game) and a tracing
// function, so the very same code can run in Node, Chromium (V8) and WebKit (JavaScriptCore).

import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const DIR = path.join(process.cwd(), "src/lib/game");

function transpile(file: string): string {
  const src = readFileSync(path.join(DIR, file), "utf8");
  return ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
}

/** Evaluates to `{ createGame, createRng, replay, hashState, defaultTierDefs, settleGame }`. */
export function engineBundleSource(): string {
  const mods = { "./rng": transpile("rng.ts"), "./engine": transpile("engine.ts"), "./replay": transpile("replay.ts") };
  return `(function () {
  var sources = ${JSON.stringify(mods)};
  var cache = {};
  function load(name) {
    if (cache[name]) return cache[name].exports;
    var module = { exports: {} };
    cache[name] = module;
    new Function("require", "module", "exports", sources[name])(load, module, module.exports);
    return module.exports;
  }
  var rng = load("./rng"), engine = load("./engine"), rep = load("./replay");
  return Object.assign({}, rng, engine, rep);
})()`;
}

/** Plays `drops` on a fresh game, hashing the whole state every 250 steps; returns everything comparable. */
export const TRACE_SOURCE = `(function (E, seed, tiers, drops) {
  var g = E.createGame({ seed: seed, tiers: tiers, width: 1, height: 1.5 });
  var hashes = [];
  var events = 0, bigBig = 0;
  for (var i = 0; i < drops.length; i++) {
    while (g.steps < drops[i].at) {
      g.step();
      if (g.steps % 250 === 0) hashes.push(E.hashState(g.state()));
    }
    g.drop(drops[i].x);
    var evs = g.drainEvents(); events += evs.length; for (var k = 0; k < evs.length; k++) if (evs[k].bigBig) bigBig++;
  }
  E.settleGame(g);
  var s = g.state();
  var fin = g.drainEvents().length;
  var rp = E.replay(seed, tiers, drops);
  return { score: g.score, over: g.over, steps: g.steps, finalHash: E.hashState(s), hashes: hashes, events: events + fin, bigBig: bigBig,
           replayScore: rp.score, replaySteps: rp.steps,
           rng: (function () { var r = E.createRng(seed); return [r.next(), r.next(), r.int(1000)]; })(),
           bodies: s.bodies.map(function (b) { return [b.id, b.tier, b.x, b.y, b.r]; }) };
})`;

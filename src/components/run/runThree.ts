// Real-time 3D renderer for 兔兔跑酷 (owner 10/31: real 3D). Loaded on demand from the run
// page only. Blender glTF assets (public/brand/run3d) — metres, +Y up, +Z forward,
// screen-left is +X. Engine units: mm, bunny 3400 mm = 1.6 m, so 1 m = 2125 mm.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { RunState, RunObject } from "@/lib/run";
import { jumpLift } from "@/lib/run/geometry";
import type { RunView } from "./runGL";

const MM = 1 / 2125; // engine mm → metres
const LANE = 2.6667, TILE = 6, AHEAD = 48, BEHIND = 10;
const FOG = 0xf6e0d1;
const BUILDINGS = ["bakery", "cafe", "flower_shop", "book_shop", "house_rose", "house_sage"] as const;
const KIND_NODE: Record<string, string> = { cart: "cart", flour: "flour", awning: "awning", puddle: "puddle", bread: "bread", "paper-bag": "bag", coffee: "coffee", ramp: "ramp", van: "van", truck: "truck" };
const hash = (i: number) => { const x = Math.sin(i * 127.1 + 31.7) * 43758.5453; return x - Math.floor(x); };
const laneX = (lane: number) => (1 - lane) * LANE;
const ease = (t: number) => t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

/** Bake a library root into one mesh per material: a building drops from ~20 draw calls to ~4. */
function bake(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (mats.length !== 1) return;
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "color"].includes(k)) g.deleteAttribute(k);
    const list = byMat.get(mats[0]) ?? []; list.push(g); byMat.set(mats[0], list);
  });
  const group = new THREE.Group();
  for (const [mat, geos] of byMat) {
    const hasColor = geos.every(g => g.attributes.color);
    if (!hasColor) for (const g of geos) g.deleteAttribute("color");
    const merged = mergeGeometries(geos, false);
    if (merged) { const mesh = new THREE.Mesh(merged, mat); mesh.matrixAutoUpdate = false; group.add(mesh); }
  }
  return group;
}

export async function createRunThree(canvas: HTMLCanvasElement): Promise<RunView & { webgl: true }> {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: (window.devicePixelRatio || 1) < 2, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(FOG, 30, AHEAD);
  const camera = new THREE.PerspectiveCamera(55, 1, .3, 80);
  scene.add(new THREE.HemisphereLight(0xfff4e6, 0xb9a48c, 1.6));
  const sun = new THREE.DirectionalLight(0xffe2c0, 1.7); sun.position.set(-4, 9, -6); scene.add(sun);

  const loader = new GLTFLoader();
  const [bunnyG, propsG, townG] = await Promise.all(["bunny", "props", "town"].map(n => loader.loadAsync(`/brand/run3d/${n}.glb`)));
  const lib = (g: typeof propsG, name: string) => g.scene.getObjectByName(name)!;

  // ---- shared blob shadow ----------------------------------------------------------
  const shadowTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d")!;
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(60,35,20,.55)"); gr.addColorStop(1, "rgba(60,35,20,0)");
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  })();
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, fog: false });
  const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

  // ---- street: road, sidewalks, facades, trees/lamps, pooled by tile slot ------------
  const slots = Math.ceil((AHEAD + BEHIND) / TILE) + 1;
  const roadT = bake(lib(townG, "road")), walkT = bake(lib(townG, "sidewalk"));
  const facades = BUILDINGS.map(n => bake(lib(townG, n)));
  const tree = bake(lib(propsG, "tree")), lamp = bake(lib(propsG, "lamp"));
  interface Slot { g: THREE.Group; left: THREE.Group[]; right: THREE.Group[]; deco: THREE.Group[]; index: number }
  const street: Slot[] = [];
  for (let i = 0; i < slots; i++) {
    const g = new THREE.Group();
    g.add(roadT.clone());
    for (const side of [-1, 1]) { const w = walkT.clone(); w.position.x = side * 5; g.add(w); }
    const make = (side: number) => facades.map(f => {
      const b = f.clone(); b.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2; b.position.set(side * 8.2, .18, 0); b.visible = false; g.add(b); return b;
    });
    const left = make(1), right = make(-1);
    const deco = [tree, lamp].flatMap(d => [1, -1].map(side => { const o = d.clone(); o.position.set(side * 4.7, .18, 0); o.visible = false; g.add(o); return o; }));
    scene.add(g); street.push({ g, left, right, deco, index: -1 });
  }

  // ---- bunny -----------------------------------------------------------------------
  const bunny = bunnyG.scene; scene.add(bunny);
  const mixer = new THREE.AnimationMixer(bunny);
  const clip = (n: string) => mixer.clipAction(THREE.AnimationClip.findByName(bunnyG.animations, n)!);
  const act = { run: clip("run"), jump: clip("jump"), slide: clip("slide"), leanL: clip("leanL"), leanR: clip("leanR"), crash: clip("crash"), idle: clip("idle") };
  for (const a of [act.jump, act.leanL, act.leanR, act.crash]) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
  let current = act.run; current.play();
  const to = (next: THREE.AnimationAction, fade = .12) => {
    if (next === current) return;
    next.reset().play(); current.crossFadeTo(next, fade, false); current = next;
  };
  const bunnyShadow = new THREE.Mesh(shadowGeo, shadowMat); bunnyShadow.renderOrder = 1; scene.add(bunnyShadow);

  // ---- props pool keyed by engine object id ----------------------------------------
  const templates = new Map<string, THREE.Group>();
  for (const node of new Set(Object.values(KIND_NODE))) { const o = propsG.scene.getObjectByName(node); if (o) templates.set(node, bake(o)); }
  // Golden loaf (value 5): the bread mesh, bigger, in glowing gold.
  const breadT = templates.get("bread");
  if (breadT) {
    const gold = breadT.clone(true); gold.scale.setScalar(1.6);
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xf2c14e, emissive: 0xc98a1a, emissiveIntensity: .55, roughness: .35, metalness: .3 });
    gold.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.material = goldMat; });
    templates.set("breadGold", gold);
  }
  const puddle = templates.get("puddle");
  puddle?.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.material = new THREE.MeshStandardMaterial({ color: 0x3f8fd0, emissive: 0x2a6ea8, emissiveIntensity: .45, roughness: .1, metalness: .1 }); });
  const free = new Map<string, THREE.Object3D[]>();
  const live = new Map<number, { node: string; o: THREE.Object3D; shadow: THREE.Mesh }>();
  const take = (node: string) => {
    const list = free.get(node); if (list?.length) { const o = list.pop()!; o.visible = true; return o; }
    const o = templates.get(node)!.clone(); scene.add(o); return o;
  };
  const shadowPool: THREE.Mesh[] = [];
  const takeShadow = () => { const s = shadowPool.pop() ?? new THREE.Mesh(shadowGeo, shadowMat); s.visible = true; if (!s.parent) scene.add(s); return s; };
  const seen = new Set<number>();

  let width = 1, height = 1, last = performance.now(), lastTick = -1;

  function placeObject(o: RunObject, s: RunState, bunnyX: number) {
    const node = o.kind === "bread" && o.value === 5 ? "breadGold" : KIND_NODE[o.kind]; if (!node || !templates.has(node)) return;
    let entry = live.get(o.id);
    if (!entry) { entry = { node, o: take(node), shadow: takeShadow() }; live.set(o.id, entry); }
    seen.add(o.id);
    let x = laneX(o.lane), y = 0;
    const z = o.z * MM;
    if (o.kind === "bread") {
      if (s.powerUps.magnetTicks > 0 && z < 6) x += (bunnyX - x) * Math.min(1, (6 - z) / 4);
      y = (o.y ?? 0) * MM + .5 + Math.sin((s.tick + o.id * 13) * .12) * .08;
      entry.o.rotation.y = s.tick * .06 + o.id;
    } else if (o.kind === "paper-bag" || o.kind === "coffee") {
      y = (o.y ?? 0) * MM + .45 + Math.sin((s.tick + o.id * 13) * .12) * .1; entry.o.rotation.y = s.tick * .04;
    }
    entry.o.position.set(x, y, z);
    // Vans/trucks/ramps stretch along Z to the engine footprint (models are 6 m / 2 m long).
    const kind0: string = o.kind;
    if (kind0 === "van" || kind0 === "truck" || kind0 === "ramp") {
      const len = (o.front + o.back) * MM, model = kind0 === "ramp" ? 2 : 6;
      entry.o.scale.set(1, 2600 * MM / 1.3, len / model); // engine roof 2600 mm vs model roof 1.3 m
      entry.o.position.z = z + (o.back - o.front) * MM / 2;
    }
    const kind: string = o.kind; // v5 adds ramp/van/truck
    const big = kind === "cart" || kind === "van" || kind === "truck";
    entry.shadow.visible = kind !== "puddle" && kind !== "ramp";
    entry.shadow.position.set(x, (o.y ?? 0) * MM + .03, z); entry.shadow.scale.set(big ? 2.2 : .9, 1, big ? 2.4 : .6);
  }

  function draw(s: RunState, quiet: boolean, crashFrame: number | null) {
    const now = performance.now(), dt = Math.min(.05, (now - last) / 1000); last = now;
    const dist = s.distance * MM;
    const change = s.player.laneChange;
    const lanePos = change ? change.from + (change.to - change.from) * ease(change.progress / 1000) : s.player.lane;
    const bunnyX = laneX(lanePos);
    const speedK = s.speed / 320;

    // Street slots recycle by absolute tile index; variants come from a stable hash.
    const firstTile = Math.floor((dist - BEHIND) / TILE);
    for (let i = 0; i < street.length; i++) {
      const idx = firstTile + i, sl = street[(idx % street.length + street.length) % street.length];
      sl.g.position.z = idx * TILE - dist + TILE / 2;
      if (sl.index !== idx) {
        sl.index = idx;
        const l = Math.floor(hash(idx * 2) * BUILDINGS.length), r = Math.floor(hash(idx * 2 + 1) * BUILDINGS.length);
        sl.left.forEach((b, k) => { b.visible = k === l; }); sl.right.forEach((b, k) => { b.visible = k === r; });
        const d = hash(idx * 7.3);
        sl.deco.forEach((o, k) => { o.visible = d < .5 ? (k === 0 || k === 1) && idx % 2 === 0 : (k === 2 || k === 3) && idx % 3 === 0; });
      }
    }

    // Props.
    seen.clear();
    for (let i = 0; i < s.objects.length; i++) placeObject(s.objects[i], s, bunnyX);
    for (const [id, e] of live) if (!seen.has(id)) {
      e.o.visible = false; (free.get(e.node) ?? free.set(e.node, []).get(e.node)!).push(e.o);
      e.shadow.visible = false; shadowPool.push(e.shadow); live.delete(id);
    }

    // Bunny pose → animation.
    const p = s.player as RunState["player"] & { y?: number };
    const lift = (p.y ?? (p.pose === "jump" ? jumpLift(p.progress) : 0)) * MM;
    if (crashFrame !== null) to(act.crash, .08);
    else if (quiet) to(act.idle);
    else if (p.pose === "jump") { to(act.jump, .06); act.jump.timeScale = 1.4; }
    else if (p.pose === "slide") to(act.slide, .08);
    else if (change) to(change.to < change.from ? act.leanR : act.leanL, .08);
    else to(act.run, .15);
    act.run.timeScale = Math.max(.9, speedK * 1.1);
    if (s.tick !== lastTick || crashFrame !== null) mixer.update(dt);
    lastTick = s.tick;
    bunny.position.set(bunnyX, lift, 0);
    bunny.rotation.y = change ? (change.to < change.from ? -.18 : .18) * Math.sin(Math.PI * change.progress / 1000) : 0;
    bunnyShadow.position.set(bunnyX, .03, 0);
    const sh = Math.max(.4, 1 - lift * .35); bunnyShadow.scale.set(1.1 * sh, 1, .8 * sh);

    // Camera: behind and above, follows lanes and height, widens with speed.
    const shake = crashFrame !== null && crashFrame < 2 && !quiet ? Math.sin(now * .06) * .12 : 0;
    camera.fov = 55 + Math.min(8, (speedK - 1) * 9) + (s.powerUps.coffeeTicks > 0 ? 4 : 0);
    camera.aspect = width / height; camera.updateProjectionMatrix();
    camera.position.set(bunnyX * .8 + shake, 4.6 + lift * .5, -7.2);
    camera.lookAt(bunnyX * .6, 1.1 + lift * .4, 7);
    renderer.render(scene, camera);
  }

  return {
    webgl: true,
    resize(w, h, dpr) { width = w; height = h; renderer.setPixelRatio(Math.min(2, dpr)); renderer.setSize(w, h, false); },
    draw,
    dispose() { renderer.dispose(); },
  };
}

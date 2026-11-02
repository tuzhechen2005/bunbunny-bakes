// Real-time 3D renderer for 兔兔跑酷 (owner 10/31: real 3D). Loaded on demand from the run
// page only. Blender glTF assets (public/brand/run3d) — metres, +Y up, +Z forward,
// screen-left is +X. Engine units: mm, bunny 3400 mm = 1.6 m, so 1 m = 2125 mm.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { RunState, RunObject } from "@/lib/run";
import { jumpLift } from "@/lib/run/geometry";
import type { RunView } from "./runGL";

const MM = 1 / 2125; // engine mm → metres
const ROAD_SCALE = .78, LANE = 2.6667 * ROAD_SCALE, TILE = 6, AHEAD = 48, BEHIND = 10;
const ROAD_HALF = 4 * ROAD_SCALE;
const FOG = 0xf7dcc6;
const KIND_NODE: Record<string, string> = { cart: "cart", flour: "flour", awning: "awning", puddle: "puddle", bread: "bread", "paper-bag": "bag", coffee: "coffee", ramp: "ramp", van: "van", truck: "truck", pothole: "pothole", "bread-wheel": "breadwheel", "double-jump-shoes": "shoes", shield: "shield" };
const hash = (i: number) => { const x = Math.sin(i * 127.1 + 31.7) * 43758.5453; return x - Math.floor(x); };
const laneX = (lane: number) => (1 - lane) * LANE;
const ease = (t: number) => t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

/** Meshopt/quantized glTF stores positions as normalized ints; transforms must run on floats. */
function floatGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "color"]) {
    const a = src.getAttribute(name) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
    if (!a) continue;
    const n = a.count, size = name === "color" ? Math.min(a.itemSize, 4) : 3, out = new Float32Array(n * size);
    for (let i = 0; i < n; i++) {
      out[i * size] = a.getX(i); out[i * size + 1] = a.getY(i); out[i * size + 2] = a.getZ(i);
      if (size === 4) out[i * size + 3] = a.getW(i);
    }
    g.setAttribute(name, new THREE.BufferAttribute(out, size));
  }
  if (src.index) g.setIndex(Array.from(src.index.array as ArrayLike<number>));
  return g;
}

/** Bake a library root into one mesh per material: a building drops from ~20 draw calls to ~4. */
function bake(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (mats.length !== 1) return;
    const g = floatGeometry(m.geometry).applyMatrix4(m.matrixWorld);
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
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
  renderer.setClearColor(0x000000, 0);
  // Soft real shadows from one low dawn sun; the box only covers the play area near the bunny.
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(FOG, 34, AHEAD + 4);
  const camera = new THREE.PerspectiveCamera(55, 1, .3, 120);
  camera.fov = 55;
  scene.add(new THREE.HemisphereLight(0xfff1df, 0xc9a98a, 1.25));
  const sun = new THREE.DirectionalLight(0xffdcb4, 2.1); sun.position.set(-6, 11, -4);
  sun.target.position.set(0, 0, 8); scene.add(sun.target);
  sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.002; sun.shadow.normalBias = .06; sun.shadow.radius = 3;
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 22, bottom: -8, near: 1, far: 40 }); sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xffb07a, .7); rim.position.set(3, 4, 18); scene.add(rim);

  // Painted clay sky: warm gradient, round clouds and two rows of sage hills, far beyond the fog.
  const skyTex = (() => {
    const c = document.createElement("canvas"); c.width = 1024; c.height = 512; const x = c.getContext("2d")!;
    const g = x.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, "#a9cfe0"); g.addColorStop(.45, "#f6cfb2"); g.addColorStop(.75, "#f7dcc6"); g.addColorStop(1, "#f7dcc6");
    x.fillStyle = g; x.fillRect(0, 0, 1024, 512);
    const cloud = (cx: number, cy: number, r: number) => { x.fillStyle = "rgba(255,247,238,.92)"; for (const [dx, dy, k] of [[0, 0, 1], [r * .9, r * .15, .8], [-r * .9, r * .2, .75], [r * .4, -r * .4, .7]]) { x.beginPath(); x.arc(cx + dx, cy + dy, r * k, 0, 7); x.fill(); } };
    cloud(180, 120, 34); cloud(520, 80, 26); cloud(820, 140, 38);
    const hills = (base: number, amp: number, color: string, seed: number) => {
      x.fillStyle = color; x.beginPath(); x.moveTo(0, 512);
      for (let i = 0; i <= 1024; i += 16) x.lineTo(i, base - Math.sin(i / 130 + seed) * amp - Math.sin(i / 55 + seed * 2) * amp * .3);
      x.lineTo(1024, 512); x.fill();
    };
    hills(330, 34, "#c9ccae", 1); hills(360, 26, "#b4bc98", 3);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(220, 110), new THREE.MeshBasicMaterial({ map: skyTex, fog: false, depthWrite: false }));
  sky.position.set(0, 30, AHEAD + 40); sky.rotation.y = Math.PI; scene.add(sky);

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder); // R16 assets are meshopt-compressed
  const [bunnyG, propsG, townG] = await Promise.all(["bunny", "props", "town"].map(n => loader.loadAsync(`/brand/run3d/${n}.glb`)));
  const lib = (g: typeof propsG, name: string) => g.scene.getObjectByName(name)!;

  // ---- shared blob shadow ----------------------------------------------------------
  const shadowTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d")!;
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(60,35,20,.55)"); gr.addColorStop(1, "rgba(60,35,20,0)");
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  })();
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: .45, depthWrite: false, fog: false });
  const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

  // ---- street: road, sidewalks, facades, trees/lamps, pooled by tile slot ------------
  const slots = Math.ceil((AHEAD + BEHIND) / TILE) + 1;
  const roadT = bake(lib(townG, "road")), walkT = bake(lib(townG, "sidewalk"));
  // Every library root except the street tiles is a facade variant (10 since R16).
  const BUILDINGS = townG.scene.children.map(c => c.name).filter(n => n && n !== "sidewalk" && n !== "road");
  const facades = BUILDINGS.map(n => bake(lib(townG, n)));
  const tree = bake(lib(propsG, "tree")), lamp = bake(lib(propsG, "lamp"));
  const extras = ["planter", "bicycle", "crate_stack", "menu_board", "bench"].map(n => propsG.scene.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o).map(bake);
  const buntingSrc = propsG.scene.getObjectByName("bunting");
  const bunting = buntingSrc ? bake(buntingSrc) : null;
  // ---- ground: one long road and two pavements whose painted textures scroll --------
  // Modelled cobbles cost ~40k triangles per tile and shimmered into dark lines in motion; a
  // mipmapped texture on one plane has no tile seams and filters cleanly at any distance.
  const box = (o: THREE.Object3D) => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };
  const rb = box(roadT), wb = box(walkT);
  const roadW = (rb.max.x - rb.min.x) * ROAD_SCALE, walkW = wb.max.x - wb.min.x, walkTop = wb.max.y;
  const GROUND_LEN = AHEAD + BEHIND + TILE * 2, GROUND_Z = (AHEAD - BEHIND) / 2;
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const paint = (w: number, h: number, draw: (x: CanvasRenderingContext2D, w: number, h: number) => void) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d")!, w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso; t.repeat.set(1, GROUND_LEN / TILE); return t;
  };
  const rand = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  // One texture repeat = one tile (TILE long): 20 rows of offset clay cobbles and the lane dashes.
  const roadTex = paint(512, 512, (x, w, h) => {
    const sx = w / roadW, rows = 22, rh = h / rows, cw = .4 * sx;
    x.fillStyle = "#c79d74"; x.fillRect(0, 0, w, h);
    const tones = ["#e4c29c", "#dcb48b", "#e9cca8", "#d6ab80", "#e0bb93"];
    for (let r = 0; r < rows; r++) for (let cx = -(r % 2) * cw / 2; cx < w; cx += cw) {
      x.fillStyle = tones[Math.floor(rand() * tones.length)];
      x.beginPath(); x.roundRect(cx + 2, r * rh + 2, cw - 4, rh - 4, 4); x.fill();
      x.fillStyle = "rgba(255,248,236,.22)"; x.beginPath(); x.roundRect(cx + 4, r * rh + 3, cw - 10, (rh - 6) * .45, 4); x.fill();
    }
    x.fillStyle = "rgba(255,250,242,.9)";
    for (const lx of [-LANE / 2, LANE / 2]) for (const z0 of [.6, 3.6]) x.fillRect(w / 2 + lx * sx - 3, z0 / TILE * h, 6, .9 / TILE * h);
  });
  const walkTex = paint(256, 256, (x, w, h) => {
    const cols = Math.max(1, Math.round(walkW)), rows = TILE, cw = w / cols, rh = h / rows;
    x.fillStyle = "#d9cab4"; x.fillRect(0, 0, w, h);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      x.fillStyle = ["#f1e7d8", "#ece0ce", "#f4ebde"][Math.floor(rand() * 3)];
      x.beginPath(); x.roundRect(c * cw + 2, r * rh + 2, cw - 4, rh - 4, 6); x.fill();
    }
  });
  const ground = (tex: THREE.Texture, w: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, GROUND_LEN).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: .95 }));
    m.receiveShadow = true; m.position.z = GROUND_Z; scene.add(m); return m;
  };
  ground(roadTex, roadW + .4).position.y = 0;
  const curbMat = new THREE.MeshStandardMaterial({ color: 0xa0704a, roughness: .8 });
  for (const side of [-1, 1]) {
    const cx = side * (ROAD_HALF + 1) + (wb.max.x + wb.min.x) / 2;
    const walk = ground(walkTex, walkW); walk.position.set(cx, walkTop, GROUND_Z);
    // The pavement body and its terracotta kerb are plain boxes: nothing on them needs to scroll.
    const body = new THREE.Mesh(new THREE.BoxGeometry(walkW, walkTop, GROUND_LEN), new THREE.MeshStandardMaterial({ color: 0xe6d8c3, roughness: .95 }));
    body.position.set(cx, walkTop / 2 - .005, GROUND_Z); scene.add(body); // vertical faces: no shadow acne
    const kerb = new THREE.Mesh(new THREE.BoxGeometry(.16, walkTop + .03, GROUND_LEN), curbMat);
    // Proud of the pavement wall by 3 cm so the two faces never z-fight.
    kerb.position.set(cx - side * (walkW / 2 - .05), (walkTop + .03) / 2, GROUND_Z); scene.add(kerb);
  }

  interface Slot { g: THREE.Group; left: THREE.Group[]; right: THREE.Group[]; deco: THREE.Group[]; extra: THREE.Group[]; flag: THREE.Group | null; index: number }
  const street: Slot[] = [];
  for (let i = 0; i < slots; i++) {
    const g = new THREE.Group();
    const make = (side: number) => facades.map(f => {
      const b = f.clone(); b.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2; b.position.set(side * (ROAD_HALF + 4.2), .18, 0); b.visible = false; g.add(b); return b;
    });
    const left = make(1), right = make(-1);
    const deco = [tree, lamp].flatMap(d => [1, -1].map(side => { const o = d.clone(); o.position.set(side * (ROAD_HALF + .7), .18, 0); o.visible = false; g.add(o); return o; }));
    // Small shop-front props sit between the trees and the facades, two candidates per side.
    const extra = extras.flatMap(e => [1, -1].map(side => { const o = e.clone(); o.position.set(side * (ROAD_HALF + 1.55), .18, 1.5); o.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2; o.visible = false; g.add(o); return o; }));
    let flag: THREE.Group | null = null;
    if (bunting) { flag = bunting.clone(); flag.position.set(0, 5.2, 0); flag.scale.x = (ROAD_HALF + 2.2) / 4; flag.visible = false; g.add(flag); }
    scene.add(g); street.push({ g, left, right, deco, extra, flag, index: -1 });
  }

  // ---- bunny -----------------------------------------------------------------------
  const bunny = bunnyG.scene; scene.add(bunny);
  bunny.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
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
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(1.15, 24, 16), new THREE.MeshStandardMaterial({ color: 0xbfe3f5, transparent: true, opacity: .28, roughness: .1, metalness: .2, depthWrite: false }));
  bubble.visible = false; scene.add(bubble);
  // Fatal-hit highlight (D182): a warm pulsing shell and outline around the obstacle that ended the run.
  const hlFillMat = new THREE.MeshBasicMaterial({ color: 0xff5a36, transparent: true, opacity: .3, depthWrite: false, fog: false, toneMapped: false });
  const hlEdgeMat = new THREE.LineBasicMaterial({ color: 0xfff1d6, transparent: true, depthTest: false, fog: false, toneMapped: false });
  const hlFill = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), hlFillMat);
  const hlEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), hlEdgeMat);
  const hl = new THREE.Group(); hl.add(hlFill, hlEdge); hl.visible = false; hl.renderOrder = 5; hlEdge.renderOrder = 6; scene.add(hl);
  let hlId = -1;

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
  // Water: deep teal centre → light edge, sky streaks and a wet rim, glossy; ripples animate on top.
  const waterTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 256; const x = c.getContext("2d")!;
    const g = x.createRadialGradient(128, 128, 10, 128, 128, 128);
    g.addColorStop(0, "#2f6f8c"); g.addColorStop(.6, "#4f93ae"); g.addColorStop(.86, "#8fbfcf"); g.addColorStop(1, "#6b5a4a");
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    x.strokeStyle = "rgba(255,255,255,.55)"; x.lineCap = "round";
    for (const [x0, y0, x1, y1, w] of [[70, 90, 150, 76, 7], [96, 130, 170, 118, 4], [80, 164, 124, 158, 3]]) { x.lineWidth = w; x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  if (puddle) {
    const model = puddle.children[0] as THREE.Mesh | undefined;
    const hasOwnWater = !!model && (model.material as THREE.MeshStandardMaterial)?.roughness !== undefined && (model.material as THREE.MeshStandardMaterial).roughness < .12;
    if (!hasOwnWater) puddle.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.material = new THREE.MeshStandardMaterial({ map: waterTex, roughness: .08, metalness: .2, emissive: 0x1d4a60, emissiveIntensity: .25 }); });
    // Two soft expanding ripple rings, shared by every puddle instance.
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .5, depthWrite: false });
    for (let i = 0; i < 2; i++) { const r = new THREE.Mesh(new THREE.RingGeometry(.28, .32, 40).rotateX(-Math.PI / 2), ringMat.clone()); r.position.y = .035; r.name = `ripple${i}`; puddle.add(r); }
  }
  const free = new Map<string, THREE.Object3D[]>();
  const live = new Map<number, { node: string; o: THREE.Object3D; shadow: THREE.Mesh; x?: number }>();
  const take = (node: string) => {
    const list = free.get(node); if (list?.length) { const o = list.pop()!; o.visible = true; return o; }
    const o = templates.get(node)!.clone(); o.traverse(m => { m.castShadow = node !== "puddle"; }); scene.add(o); return o;
  };
  const shadowPool: THREE.Mesh[] = [];
  const takeShadow = () => { const s = shadowPool.pop() ?? new THREE.Mesh(shadowGeo, shadowMat); s.visible = true; if (!s.parent) scene.add(s); return s; };
  const seen = new Set<number>();

  let width = 1, height = 1, last = performance.now(), lastTick = -1;
  // Adaptive quality: start at 1.5x pixels; sustained slow frames step the resolution down to 1x,
  // then drop the real shadows (the blob shadows stay). Never steps back up within a run.
  let deviceDpr = 1, dprCap = 1.5, frames = 0, slowFrames = 0;
  const applySize = () => { renderer.setPixelRatio(Math.min(dprCap, deviceDpr)); renderer.setSize(width, height, false); };
  function watchFrame(ms: number) {
    if (ms > 250) return; // a pause or a resize, not a slow frame
    frames++; if (ms > 24) slowFrames++;
    if (frames < 90) return;
    if (slowFrames > 30) {
      if (dprCap > 1 && deviceDpr > 1) { dprCap = Math.max(1, dprCap - .25); applySize(); }
      else if (sun.castShadow) sun.castShadow = false;
    }
    frames = slowFrames = 0;
  }

  function placeObject(o: RunObject, s: RunState, bunnyX: number) {
    const node = o.kind === "bread" && o.value === 5 ? "breadGold" : KIND_NODE[o.kind]; if (!node || !templates.has(node)) return;
    let entry = live.get(o.id);
    if (!entry) { entry = { node, o: take(node), shadow: takeShadow() }; live.set(o.id, entry); }
    seen.add(o.id);
    let x = laneX(o.lane), y = 0;
    const z = o.z * MM;
    // Lane-changing trucks (and anything riding them) slide across instead of snapping.
    if (o.kind === "truck" || o.carrierId !== undefined) { entry.x = entry.x === undefined ? x : entry.x + (x - entry.x) * .18; x = entry.x; }
    if (o.kind === "bread") {
      if (s.powerUps.magnetTicks > 0 && z < 6) x += (bunnyX - x) * Math.min(1, (6 - z) / 4);
      y = (o.y ?? 0) * MM + .5 + Math.sin((s.tick + o.id * 13) * .12) * .08;
      entry.o.rotation.y = s.tick * .06 + o.id;
    } else if (o.kind === "bread-wheel") {
      entry.o.rotation.x = -(s.distance * MM + z) / .6; // rolls toward the bunny
    } else if (o.kind === "paper-bag" || o.kind === "coffee" || o.kind === "double-jump-shoes" || o.kind === "shield") {
      y = (o.y ?? 0) * MM + .45 + Math.sin((s.tick + o.id * 13) * .12) * .1; entry.o.rotation.y = s.tick * .04;
    }
    entry.o.position.set(x, y, z);
    if (o.kind === "truck") {
      let lamp = entry.o.getObjectByName("signal-lamp") as THREE.Mesh | undefined;
      if (!lamp) { lamp = new THREE.Mesh(new THREE.SphereGeometry(.18, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffb53a })); lamp.name = "signal-lamp"; lamp.position.y = 1.62; entry.o.add(lamp); }
      const pending = (o.signalUntil ?? 0) > s.tick && o.targetLane !== undefined && o.targetLane !== o.lane;
      lamp.visible = pending && Math.floor(s.tick / 6) % 2 === 0;
      if (pending) lamp.position.x = (laneX(o.targetLane!) - laneX(o.lane)) > 0 ? .7 : -.7;
    }
    if (o.kind === "puddle") for (let i = 0; i < 2; i++) {
      const r = entry.o.getObjectByName(`ripple${i}`) as THREE.Mesh | undefined; if (!r) continue;
      const k = ((s.tick + o.id * 17) / 70 + i * .5) % 1;
      r.scale.set(.6 + k * 2.2, 1, .45 + k * 1.5); (r.material as THREE.MeshBasicMaterial).opacity = .5 * (1 - k);
    }
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
    const now = performance.now(), dt = Math.min(.05, (now - last) / 1000); watchFrame(now - last); last = now;
    const dist = s.distance * MM;
    const change = s.player.laneChange;
    const lanePos = change ? change.from + (change.to - change.from) * ease(change.progress / 1000) : s.player.lane;
    const bunnyX = laneX(lanePos);
    const speedK = Math.min(2.4, s.speed / 320);

    // Street slots recycle by absolute tile index; variants come from a stable hash.
    const firstTile = Math.floor((dist - BEHIND) / TILE);
    const scroll = -((dist / TILE) % 1); roadTex.offset.y = scroll; walkTex.offset.y = scroll;
    for (let i = 0; i < street.length; i++) {
      const idx = firstTile + i, sl = street[(idx % street.length + street.length) % street.length];
      sl.g.position.z = idx * TILE - dist + TILE / 2;
      if (sl.index !== idx) {
        sl.index = idx;
        const l = Math.floor(hash(idx * 2) * BUILDINGS.length), r = Math.floor(hash(idx * 2 + 1) * BUILDINGS.length);
        sl.left.forEach((b, k) => { b.visible = k === l; }); sl.right.forEach((b, k) => { b.visible = k === r; });
        // Deco: [tree L, tree R, lamp L, lamp R] — alternate per tile so both pavements always feel lived-in.
        const even = idx % 2 === 0;
        sl.deco.forEach((o, k) => { o.visible = k < 2 ? (k === 0 ? even : !even) : (k === 2 ? !even : even); });
        const pickL = Math.floor(hash(idx * 3.7) * (sl.extra.length / 2 + 2)), pickR = Math.floor(hash(idx * 5.1) * (sl.extra.length / 2 + 2));
        sl.extra.forEach((o, k) => { o.visible = k % 2 === 0 ? k / 2 === pickL : (k - 1) / 2 === pickR; });
        if (sl.flag) sl.flag.visible = idx % 4 === 0;
      }
    }

    // Props.
    seen.clear();
    for (let i = 0; i < s.objects.length; i++) placeObject(s.objects[i], s, bunnyX);
    for (const [id, e] of live) if (!seen.has(id)) {
      e.o.visible = false; (free.get(e.node) ?? free.set(e.node, []).get(e.node)!).push(e.o);
      e.shadow.visible = false; shadowPool.push(e.shadow); live.delete(id);
    }

    // Fatal obstacle: wrap the live model's real bounds, pulsing while the result sheet waits.
    const fatal = s.death ? live.get(s.death.id) : undefined;
    if (fatal) {
      if (hlId !== s.death!.id) {
        hlId = s.death!.id;
        const b = box(fatal.o), size = b.getSize(new THREE.Vector3()).addScalar(.3), mid = b.getCenter(new THREE.Vector3());
        if (size.y < .6) { size.y = .6; mid.y = .3; } // flat hazards (puddle, pothole) still get a readable volume
        hl.position.copy(mid); hl.scale.copy(size);
      }
      const pulse = quiet ? .75 : .5 + .5 * Math.sin(now * .014);
      hlFillMat.opacity = .38 + .3 * pulse; hlEdgeMat.opacity = .8 + .2 * pulse; hl.visible = true;
    } else { hl.visible = false; hlId = -1; }

    // Bunny pose → animation.
    const p = s.player as RunState["player"] & { y?: number };
    const lift = (p.y ?? (p.pose === "jump" ? jumpLift(p.progress) : 0)) * MM;
    if (crashFrame !== null) to(act.crash, .08);
    else if (quiet) to(act.idle);
    else if (p.pose === "jump") { to(act.jump, .06); act.jump.timeScale = 1.4; }
    else if (p.pose === "slide") to(act.slide, .08);
    else if (change) to(change.to < change.from ? act.leanR : act.leanL, .08);
    else to(act.run, .15);
    act.run.timeScale = Math.max(.9, Math.min(2.4, speedK * 1.1));
    if (s.tick !== lastTick || crashFrame !== null) mixer.update(dt);
    lastTick = s.tick;
    bunny.position.set(bunnyX, lift, 0);
    bunny.rotation.y = change ? (change.to < change.from ? -.18 : .18) * Math.sin(Math.PI * change.progress / 1000) : 0;
    bunnyShadow.position.set(bunnyX, .03, 0);
    bubble.visible = !!(s.player as RunState["player"] & { shield?: boolean }).shield;
    if (bubble.visible) { bubble.position.set(bunnyX, lift + .85, 0); const k = 1 + Math.sin(s.tick * .15) * .03; bubble.scale.set(k, k, k); }
    const sh = Math.max(.4, 1 - lift * .35); bunnyShadow.scale.set(1.1 * sh, 1, .8 * sh);

    // Camera: behind and above, follows lanes and height, widens with speed.
    const shake = crashFrame !== null && crashFrame < 2 && !quiet ? Math.sin(now * .06) * .12 : 0;
    // Field of view follows the 480..720 mm/tick curve (coffee reaches 1080); eased so the coffee burst is not a jump.
    const fovTarget = 55 + Math.min(11, Math.max(0, (s.speed - 480) / 240) * 7);
    camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 6);
    camera.aspect = width / height; camera.updateProjectionMatrix();
    camera.position.set(bunnyX * .8 + shake, 4.6 + lift * .5, -7.2);
    camera.lookAt(bunnyX * .6, 1.1 + lift * .4, 7);
    sky.position.x = camera.position.x;
    renderer.render(scene, camera);
  }

  return {
    webgl: true,
    resize(w, h, dpr) { width = w; height = h; deviceDpr = dpr; applySize(); },
    draw,
    dispose() { renderer.dispose(); },
  };
}

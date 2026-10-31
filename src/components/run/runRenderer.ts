import type { RunState, RunObjectKind } from "@/lib/run";
import { manifest, type AssetName, type RunArt } from "./runAssets";
import { project } from "./runHelpers";
const objectArt: Record<RunObjectKind, AssetName> = { cart:"bread-cart", flour:"flour-sacks", awning:"shop-awning", puddle:"puddle", bread:"loaf-spin", "paper-bag":"paper-bag", coffee:"coffee-cup" };
export function renderRun(ctx: CanvasRenderingContext2D, art: RunArt, s: RunState, w: number, h: number, quiet: boolean, crashFrame: number | null = null) {
  const sprite = (name: AssetName, frame: number, x: number, y: number, scale: number) => {
    const a = manifest.assets[name], f = a.frames[Math.min(a.frameCount-1, Math.max(0, frame))];
    const [sx,sy,sw,sh] = f.rect, [ax,ay] = f.anchor;
    ctx.drawImage(art[name],sx,sy,sw,sh,x-ax*scale,y-ay*scale,sw*scale,sh*scale);
  };
  ctx.clearRect(0,0,w,h);
  ctx.drawImage(art['sky-dawn'],0,0,w,h);
  // Project the top-down stone texture in two-pixel horizontal strips into a trapezoid.
  const horizon = h*.24, groundSpan = h*.62;
  const road = art['road-stone'];
  for (let y = Math.ceil(horizon+1); y < h; y += 2) {
    const depth = (y-horizon)/groundSpan;
    const z = 14000*(1/depth-1);
    const nextZ = 14000*(1/((y+2-horizon)/groundSpan)-1);
    const sy = ((s.distance+z)/24 % road.height+road.height)%road.height;
    const sh = Math.min(road.height-sy, Math.max(1, Math.abs(z-nextZ)/24));
    const half = w*.45*depth;
    ctx.drawImage(road,0,sy,road.width,sh,w/2-half,y,half*2,2.5);
  }
  // Camera-plane shop strips remain upright; repeat the same palette along each side.
  const spacing=16000, offset=s.distance%spacing;
  const palette = Math.floor(s.distance/400000)%3;
  const mix = Math.min(1,(s.distance%400000)/40000);
  for(let i=7;i>=0;i--) {
    const z=i*spacing-offset;
    if(z < -3000) continue;
    const p=project(1,z,w,h);
    for(const side of [-1,1]) {
      const name=side<0?'shops-left':'shops-right';
      const x=w/2+side*w*.57*p.scale/(w/390);
      ctx.globalAlpha=1-mix;
      sprite(name,(palette+2)%3,x,p.y,.72*p.scale);
      ctx.globalAlpha=mix;
      sprite(name,palette,x,p.y,.72*p.scale);
      ctx.globalAlpha=1;
    }
  }
  for(const o of [...s.objects].reverse()) {
    const p=project(o.lane,o.z,w,h), name=objectArt[o.kind];
    const frame=o.kind==='bread' && !quiet ? Math.floor(s.tick/6)%6 : 0;
    // Obstacle silhouettes fit within a lane; collectibles read smaller than the courier.
    const size=o.kind==='awning'?.64:o.kind==='bread'?.65:.52;
    sprite(name,frame,p.x,p.y,size*p.scale);
  }
  const change=s.player.laneChange;
  const lane=change ? change.from+(change.to-change.from)*change.progress/1000 : s.player.lane;
  const p=project(lane,0,w,h);
  let name: AssetName='bunny-run', frame=quiet?0:Math.floor(s.tick*14/60)%8;
  let lift=0;
  if(crashFrame !== null) {name='bunny-crash'; frame=crashFrame;}
  else if(s.player.pose==='jump') {name='bunny-jump';frame=Math.min(2,Math.floor(s.player.progress*3/1000));lift=Math.sin(Math.PI*s.player.progress/1000)*h*.105;}
  else if(s.player.pose==='slide') {name='bunny-slide';frame=s.player.progress<250?0:1;}
  else if(change) {name='bunny-lean';frame=change.to<change.from?0:1;}
  sprite(name,frame,p.x,p.y-lift,.65*p.scale);
}

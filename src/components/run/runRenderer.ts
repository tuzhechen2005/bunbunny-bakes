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
  ctx.globalAlpha=1;
  ctx.globalCompositeOperation='source-over';
  ctx.filter='none';
  ctx.imageSmoothingEnabled=true;
  ctx.imageSmoothingQuality='high';
  ctx.clearRect(0,0,w,h);
  const sky=ctx.createLinearGradient(0,0,0,h*.65);
  sky.addColorStop(0,'#b8dcec');
  sky.addColorStop(.45,'#f9d8c6');
  sky.addColorStop(1,'#ffe6c9');
  ctx.fillStyle=sky;
  ctx.fillRect(0,0,w,h);
  // Project the top-down stone texture in two-pixel horizontal strips into a trapezoid.
  const horizon = h*.24, groundSpan = h*.62;
  const bottomDepth=(h-horizon)/groundSpan;
  // Continuous pavements share the road's vanishing point and extend below the camera.
  ctx.fillStyle='#e8d4b9';
  ctx.beginPath();
  ctx.moveTo(w/2,horizon);
  ctx.lineTo(w/2+w*.51*bottomDepth,h);
  ctx.lineTo(w/2-w*.51*bottomDepth,h);
  ctx.closePath();
  ctx.fill();
  const road = art['road-stone'];
  for (let y = Math.ceil(horizon+1); y < h; y += 2) {
    const depth = (y-horizon)/groundSpan;
    const z = 14000*(1/depth-1);
    const nextZ = 14000*(1/((y+2-horizon)/groundSpan)-1);
    const sy = ((s.distance+z)/24 % road.height+road.height)%road.height;
    const sh = Math.min(road.height-sy, Math.max(1, Math.abs(z-nextZ)/24));
    const half = w*.405*depth;
    ctx.drawImage(road,0,sy,road.width,sh,w/2-half,y,half*2,2.5);
  }
  // Lane boundaries sit halfway between the three gameplay lane centers.
  for(const side of [-1,1]) {
    ctx.strokeStyle='rgba(255,244,219,.42)';
    ctx.lineWidth=1.25;
    ctx.beginPath();
    ctx.moveTo(w/2,horizon);
    ctx.lineTo(w/2+side*w*.135*bottomDepth,h);
    ctx.stroke();
    ctx.strokeStyle='rgba(255,244,219,.7)';
    ctx.beginPath();
    ctx.moveTo(w/2,horizon);
    ctx.lineTo(w/2+side*w*.405*bottomDepth,h);
    ctx.stroke();
  }
  // Texture upright walls running along world Z, rather than camera-facing billboards.
  // Crop a single facade from the repeating atlas (excluding the next roof and pavement).
  // Each screen column uses inverse perspective, keeping its foot on the side pavement.
  const spacing=11000, offset=s.distance%spacing;
  const pixel=1/ctx.getTransform().a;
  const facadeEdge=w*.46;
  for(let i=28;i>=-1;i--) {
    const nearZ=i*spacing-offset, farZ=nearZ+spacing;
    if(farZ<=-4000)continue;
    const nearDepth=14000/(14000+Math.max(-4000,nearZ));
    const farDepth=14000/(14000+farZ);
    const first=Math.max(0,facadeEdge*farDepth);
    const last=Math.min(w/2,facadeEdge*nearDepth);
    // Change palette by world block, so existing buildings never fade or pop in place.
    const palette=((Math.floor((s.distance+nearZ)/396000)%3)+3)%3;
    for(let u=first;u<last;u+=pixel) {
      const width=Math.min(pixel,last-u);
      const depth=(u+width/2)/facadeEdge;
      const z=14000*(1/depth-1);
      const along=Math.max(0,Math.min(1,(z-nearZ)/spacing));
      const base=horizon+groundSpan*depth;
      const height=210*w/390*depth;
      for(const side of [-1,1]) {
        const name=side<0?'shops-left':'shops-right';
        const sourceX=(side<0?1-along:along)*238;
        const sourceWidth=Math.min(239-sourceX,Math.max(.5,14000*width/(facadeEdge*depth*depth)/spacing*239));
        const x=side<0?w/2-u-width:w/2+u;
        ctx.drawImage(art[name],palette*256+sourceX,0,sourceWidth,362,x,base-height,width+.25*pixel,height);
      }
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

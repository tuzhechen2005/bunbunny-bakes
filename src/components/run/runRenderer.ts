import type { RunState, RunObjectKind } from "@/lib/run";
import { manifest, type AssetName, type RunArt } from "./runAssets";
import { project } from "./runHelpers";
const objectArt: Record<RunObjectKind, AssetName> = { cart:"bread-cart", flour:"flour-sacks", awning:"shop-awning", puddle:"puddle", bread:"loaf-spin", "paper-bag":"paper-bag", coffee:"coffee-cup" };

const BUILDING_SPACING=11000;
const mod=(n:number,d:number)=>((n%d)+d)%d;

function surface(width:number,height:number) {
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(width));canvas.height=Math.max(1,Math.round(height));
  const ctx=canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  return {canvas,ctx};
}

/** Crop the repeating facade once and prefilter smaller strips for distant buildings. */
function facadeStrips(art:RunArt) {
  return (['shops-left','shops-right'] as const).map(name=>
    [0,1,2].map(palette=>{
      const first=surface(239,362);
      first.ctx.drawImage(art[name],palette*256,0,239,362,0,0,239,362);
      const levels=[first.canvas];
      while(levels.at(-1)!.height>8) {
        const previous=levels.at(-1)!;
        const next=surface(previous.width/2,previous.height/2);
        next.ctx.drawImage(previous,0,0,next.canvas.width,next.canvas.height);
        levels.push(next.canvas);
      }
      return levels;
    })
  );
}

/** Size-dependent geometry and painted layers live as long as the canvas/size/art do. */
function cacheScenery(art:RunArt,w:number,h:number,scale:number) {
  const sky=surface(w*scale,h*scale),lanes=surface(w*scale,h*scale);
  sky.ctx.setTransform(scale,0,0,scale,0,0);
  lanes.ctx.setTransform(scale,0,0,scale,0,0);
  const gradient=sky.ctx.createLinearGradient(0,0,0,h*.65);
  gradient.addColorStop(0,'#b8dcec');gradient.addColorStop(.45,'#f9d8c6');gradient.addColorStop(1,'#ffe6c9');
  sky.ctx.fillStyle=gradient;sky.ctx.fillRect(0,0,w,h);
  const horizon=h*.24,groundSpan=h*.62,bottomDepth=(h-horizon)/groundSpan;
  sky.ctx.fillStyle='#e8d4b9';sky.ctx.beginPath();sky.ctx.moveTo(w/2,horizon);
  sky.ctx.lineTo(w/2+w*.51*bottomDepth,h);sky.ctx.lineTo(w/2-w*.51*bottomDepth,h);
  sky.ctx.closePath();sky.ctx.fill();
  for(const side of [-1,1]) {
    for(const [edge,opacity] of [[.135,.42],[.405,.7]]) {
      lanes.ctx.strokeStyle=`rgba(255,244,219,${opacity})`;lanes.ctx.lineWidth=1.25;
      lanes.ctx.beginPath();lanes.ctx.moveTo(w/2,horizon);
      lanes.ctx.lineTo(w/2+side*w*edge*bottomDepth,h);lanes.ctx.stroke();
    }
  }
  const road=[];
  for(let y=Math.ceil(horizon+1);y<h;y+=2) {
    const depth=(y-horizon)/groundSpan,z=14000*(1/depth-1);
    const nextZ=14000*(1/((y+2-horizon)/groundSpan)-1),half=w*.405*depth;
    road.push({y,z,x:w/2-half,width:half*2,sh:Math.max(1,Math.abs(z-nextZ)/24)});
  }
  const facades=facadeStrips(art),walls=[];
  // One CSS-pixel strip is enough for scenery; DPR still controls the cached layers
  // and foreground sprites. Background draw-call count must not triple on a 3x phone.
  const edge=w*.46,pixel=1;
  // Geometry is stationary: movement only changes the sampled world texture coordinate.
  for(let u=edge*14000/(14000+29*BUILDING_SPACING);u<w/2;u+=pixel) {
    const width=Math.min(pixel,w/2-u),depth=(u+width/2)/edge;
    const z=14000*(1/depth-1),height=210*w/390*depth;
    const strips=facades.map(side=>side.map(levels=>{
      let level=0;
      while(level+1<levels.length&&levels[level+1].height>=height*scale)level++;
      return levels[level];
    }));
    walls.push({u,width,z,height,y:horizon+groundSpan*depth-height,strips,
      sourceWidth:Math.max(.5,14000*width/(edge*depth*depth)/BUILDING_SPACING*239)});
  }
  return {art,w,h,scale,sky:sky.canvas,lanes:lanes.canvas,road,walls};
}
const sceneryCache=new WeakMap<CanvasRenderingContext2D,ReturnType<typeof cacheScenery>>();

export function renderRun(ctx: CanvasRenderingContext2D, art: RunArt, s: RunState, w: number, h: number, quiet: boolean, crashFrame: number | null = null) {
  const sprite = (name: AssetName, frame: number, x: number, y: number, scale: number) => {
    const a = manifest.assets[name], f = a.frames[Math.min(a.frameCount-1, Math.max(0, frame))];
    const [sx,sy,sw,sh] = f.rect, [ax,ay] = f.anchor;
    ctx.drawImage(art[name],sx,sy,sw,sh,x-ax*scale,y-ay*scale,sw*scale,sh*scale);
  };
  const scale=ctx.getTransform().a;
  let scenery=sceneryCache.get(ctx);
  if(!scenery||scenery.art!==art||scenery.w!==w||scenery.h!==h||scenery.scale!==scale) {
    scenery=cacheScenery(art,w,h,scale);
    sceneryCache.set(ctx,scenery);
  }
  ctx.globalAlpha=1;
  ctx.globalCompositeOperation='source-over';
  ctx.filter='none';
  ctx.imageSmoothingEnabled=true;
  // Static layers and facade mipmaps already received high-quality filtering at cache time.
  ctx.imageSmoothingQuality='low';
  ctx.drawImage(scenery.sky,0,0,w,h);
  const road=art['road-stone'];
  for(const row of scenery.road) {
    const sy=mod((s.distance+row.z)/24,road.height);
    ctx.drawImage(road,0,sy,road.width,Math.min(road.height-sy,row.sh),row.x,row.y,row.width,2.5);
  }
  ctx.drawImage(scenery.lanes,0,0,w,h);
  const farZ=29*BUILDING_SPACING-mod(s.distance,BUILDING_SPACING);
  for(const column of scenery.walls) {
    if(column.z>farZ)continue;
    const worldZ=s.distance+column.z;
    const along=mod(worldZ,BUILDING_SPACING)/BUILDING_SPACING;
    const palette=mod(Math.floor(worldZ/(36*BUILDING_SPACING)),3);
    for(let side=0;side<2;side++) {
      const strip=column.strips[side][palette];
      const sourceX=(side===0?1-along:along)*238;
      const sourceWidth=Math.min(239-sourceX,column.sourceWidth);
      const sourceScale=strip.width/239;
      ctx.drawImage(strip,sourceX*sourceScale,0,sourceWidth*sourceScale,strip.height,
        side===0?w/2-column.u-column.width:w/2+column.u,column.y,column.width+.25/scale,column.height);
    }
  }
  ctx.imageSmoothingQuality='high';
  for(let i=s.objects.length-1;i>=0;i--) {
    const o=s.objects[i];
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

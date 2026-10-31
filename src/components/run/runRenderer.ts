import { isRunObstacle, type RunState, type RunObjectKind } from "@/lib/run";
import { manifest, type AssetName, type RunArt } from "./runAssets";
import { project } from "./runHelpers";
import { runGeometry, jumpLift, slideBodyHeight, worldHeightPixels, projectionZ } from "@/lib/run/geometry";
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

/** Size-dependent geometry and painted layers live as long as the canvas/size/art do. */
function cacheScenery(art:RunArt,w:number,h:number,scale:number) {
  const sky=surface(w*scale,h*scale),lanes=surface(w*scale,h*scale);
  sky.ctx.setTransform(scale,0,0,scale,0,0);
  lanes.ctx.setTransform(scale,0,0,scale,0,0);
  const gradient=sky.ctx.createLinearGradient(0,0,0,h*.65);
  gradient.addColorStop(0,'#b8dcec');gradient.addColorStop(.45,'#f9d8c6');gradient.addColorStop(1,'#ffe6c9');
  sky.ctx.fillStyle=gradient;sky.ctx.fillRect(0,0,w,h);
  const horizon=h*runGeometry.horizon,groundSpan=h*(runGeometry.feet-runGeometry.horizon),bottomDepth=(h-horizon)/groundSpan;
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
    const depth=(y-horizon)/groundSpan,z=projectionZ(depth);
    const nextZ=projectionZ((y+2-horizon)/groundSpan),half=w*.405*depth;
    road.push({y,z,x:w/2-half,width:half*2,sh:Math.max(1,Math.abs(z-nextZ)/24)});
  }
  return {art,w,h,scale,sky:sky.canvas,lanes:lanes.canvas,road};
}
const sceneryCache=new WeakMap<CanvasRenderingContext2D,ReturnType<typeof cacheScenery>>();

export function renderRun(ctx: CanvasRenderingContext2D, art: RunArt, s: RunState, w: number, h: number, quiet: boolean, crashFrame: number | null = null) {
  const sprite = (name: AssetName, frame: number, x: number, y: number, scale: number, scaleY = scale) => {
    const a = manifest.assets[name], f = a.frames[Math.min(a.frameCount-1, Math.max(0, frame))];
    const [sx,sy,sw,sh] = f.rect, [ax,ay] = f.anchor;
    ctx.drawImage(art[name],sx,sy,sw,sh,x-ax*scale,y-ay*scaleY,sw*scale,sh*scaleY);
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
  // Static layers were filtered at cache time; foreground sprites use high-quality sampling.
  ctx.imageSmoothingQuality='low';
  ctx.drawImage(scenery.sky,0,0,w,h);
  const road=art['road-stone'];
  for(const row of scenery.road) {
    const sy=mod((s.distance+row.z)/24,road.height);
    ctx.drawImage(road,0,sy,road.width,Math.min(road.height-sy,row.sh),row.x,row.y,row.width,2.5);
  }
  ctx.drawImage(scenery.lanes,0,0,w,h);
  ctx.imageSmoothingQuality='high';
  // Whole pre-rendered shops: preserve aspect ratio, bevels and roof perspective.
  for(let row=14;row>=0;row--) {
    const z=row*BUILDING_SPACING-mod(s.distance,BUILDING_SPACING);
    if(z < -2500) continue;
    const p=project(1,z,w,h);
    const palette=mod(Math.floor((s.distance+z)/BUILDING_SPACING),3);
    for(const side of [-1,1]) {
      sprite(side<0?'shops-left':'shops-right',palette,
        w/2+side*w*.72*p.scale/(w/390),p.y,.90*p.scale);
    }
  }
  ctx.imageSmoothingQuality='high';
  for(let i=s.objects.length-1;i>=0;i--) {
    const o=s.objects[i];
    const p=project(o.lane,o.z,w,h), name=objectArt[o.kind];
    const frame=o.kind==='bread' && !quiet ? Math.floor(s.tick/6)%6 : 0;
    if(isRunObstacle(o.kind)) {
      const placement=obstaclePlacement(o.kind,o.lane,o.z,w,h);
      sprite(name,frame,placement.x,placement.y,placement.scale);
    } else {
      sprite(name,frame,p.x,p.y,(o.kind==='bread'?.65:.52)*p.scale);
    }
  }
  const change=s.player.laneChange;
  const lane=change ? change.from+(change.to-change.from)*change.progress/1000 : s.player.lane;
  const p=project(lane,0,w,h);
  let name: AssetName='bunny-run', frame=quiet?0:Math.floor(s.tick*14/60)%8;
  let lift=0;
  if(crashFrame !== null) {name='bunny-crash'; frame=crashFrame;}
  else if(s.player.pose==='jump') {name='bunny-jump';frame=Math.min(2,Math.floor(s.player.progress*3/1000));lift=worldHeightPixels(jumpLift(s.player.progress),h);}
  else if(s.player.pose==='slide') {name='bunny-slide';frame=s.player.progress<250?0:1;}
  else if(change) {name='bunny-lean';frame=change.to<change.from?0:1;}
  const sliding=s.player.pose==='slide' && crashFrame===null;
  const bodyHeight=sliding ? slideBodyHeight(s.player.progress) : runGeometry.standingHeight;
  const runFrame=manifest.assets['bunny-run'].frames[0];
  const standingScale=worldHeightPixels(runGeometry.standingHeight,h)/(runFrame.anchor[1]-runFrame.contentBounds[1]);
  if(sliding) {
    // Blend the upright crouch into the modeled low pose; keep both feet and body
    // height on the authoritative curve throughout entry and exit.
    const crouch=(runGeometry.standingHeight-bodyHeight)/(runGeometry.standingHeight-runGeometry.slideHeight);
    ctx.globalAlpha=1-crouch;
    sprite('bunny-run',0,p.x,p.y,standingScale,worldHeightPixels(bodyHeight,h)/(runFrame.anchor[1]-runFrame.contentBounds[1]));
    ctx.globalAlpha=crouch;
  }
  const f=manifest.assets[name].frames[frame];
  const scaleY=worldHeightPixels(bodyHeight,h)/(f.anchor[1]-f.contentBounds[1]);
  sprite(name,frame,p.x,p.y-lift,sliding ? standingScale : scaleY,scaleY);
  ctx.globalAlpha=1;
}

/** Fit the rendered ground footprint to the same front/back used by replay. */
export function obstaclePlacement(kind: keyof typeof runGeometry.obstacles,lane:number,z:number,w:number,h:number) {
  const asset=manifest.assets[objectArt[kind]];
  if(!('groundFront' in asset) || !('groundBack' in asset)) throw new Error("Missing RUN geometry");
  const shape=runGeometry.obstacles[kind];
  const front=project(lane,z-shape.front,w,h),back=project(lane,z+shape.back,w,h);
  const scale=(front.y-back.y)/(asset.groundFront[1]-asset.groundBack[1]);
  return {x:project(lane,z,w,h).x,y:front.y-(asset.groundFront[1]-asset.anchor[1])*scale,scale};
}

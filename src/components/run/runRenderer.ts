import { isRunObstacle, type RunState, type RunObjectKind } from "@/lib/run";
import { manifest, type AssetName, type RunArt } from "./runAssets";
import { runGeometry, jumpLift, slideBodyHeight, worldHeightPixels, projectionDepth, projectionZ } from "@/lib/run/geometry";
const objectArt: Record<RunObjectKind, AssetName> = { cart:"bread-cart", flour:"flour-sacks", awning:"shop-awning", puddle:"puddle", bread:"loaf-spin", "paper-bag":"paper-bag", coffee:"coffee-cup", ramp:"bread-cart", van:"bread-cart", truck:"bread-cart", pothole:"puddle", "bread-wheel":"loaf-spin", "double-jump-shoes":"paper-bag", shield:"coffee-cup" };
const mod=(n:number,d:number)=>((n%d)+d)%d;
const FACADE_LENGTH=15000, FACADE_HEIGHT=12500;
const MIP_STEP=Math.SQRT1_2;

function surface(width:number,height:number) {
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(width));canvas.height=Math.max(1,Math.round(height));
  const ctx=canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  return {canvas,ctx};
}
function mipChain(source:CanvasImageSource,width:number,height:number) {
  const levels:HTMLCanvasElement[]=[];
  for(let factor=1;factor>=1/64;factor*=MIP_STEP) {
    const layer=surface(width*factor,height*factor);
    layer.ctx.drawImage(source,0,0,layer.canvas.width,layer.canvas.height);
    levels.push(layer.canvas);
  }
  return levels;
}
function mipIndex(ratio:number) {return Math.max(0,Math.min(12,Math.floor(Math.log(Math.max(1/64,ratio))/Math.log(MIP_STEP))));}

/** Allocate and resample only at load/resize, before the animation clock starts. */
function cacheScenery(art:RunArt,w:number,h:number,dpr:number) {
  const sky=surface(w*dpr,h*dpr),lanes=surface(w*dpr,h*dpr);
  sky.ctx.setTransform(dpr,0,0,dpr,0,0);lanes.ctx.setTransform(dpr,0,0,dpr,0,0);
  const gradient=sky.ctx.createLinearGradient(0,0,0,h*.65);
  gradient.addColorStop(0,'#b8dcec');gradient.addColorStop(.45,'#f9d8c6');gradient.addColorStop(1,'#ffe6c9');
  sky.ctx.fillStyle=gradient;sky.ctx.fillRect(0,0,w,h);
  const horizon=h*runGeometry.horizon,span=h*(runGeometry.feet-runGeometry.horizon),bottomDepth=(h-horizon)/span;
  sky.ctx.fillStyle='#e8d4b9';sky.ctx.fillRect(0,horizon,w,h-horizon);
  for(const side of [-1,1]) for(const [edge,opacity] of [[.135,.42],[.405,.7]]) {
    lanes.ctx.strokeStyle=`rgba(255,244,219,${opacity})`;lanes.ctx.lineWidth=1.25;
    lanes.ctx.beginPath();lanes.ctx.moveTo(w/2,horizon);
    lanes.ctx.lineTo(w/2+side*w*edge*bottomDepth,h);lanes.ctx.stroke();
  }
  const sprites={} as Record<AssetName,HTMLCanvasElement[][]>;
  for(const name of Object.keys(manifest.assets) as AssetName[]) {
    if(name==='sky-dawn')continue;
    const a=manifest.assets[name];
    sprites[name]=a.frames.map(f=>{
      const base=surface(f.rect[2],f.rect[3]);
      base.ctx.drawImage(art[name],f.rect[0],f.rect[1],f.rect[2],f.rect[3],0,0,f.rect[2],f.rect[3]);
      return mipChain(base.canvas,f.rect[2],f.rect[3]);
    });
  }
  // Each road row has a prefiltered texture at its actual projected width.
  // Its horizontal scale never changes during a run; only the source Y scrolls.
  const roadClip=new Path2D();
  roadClip.moveTo(w/2,horizon);roadClip.lineTo(w/2+w*.405*bottomDepth,h);
  roadClip.lineTo(w/2-w*.405*bottomDepth,h);roadClip.closePath();
  const road=[];
  const roadArt=manifest.assets['road-stone'];
  const roadMips=sprites['road-stone'][0];
  for(let y=Math.ceil(horizon+2);y<h;y+=4) {
    const depth=(y+2-horizon)/span,z=projectionZ(depth),half=w*.405*(y+4.25-horizon)/span;
    const nextZ=projectionZ((y+6-horizon)/span);
    const ratio=Math.min(half*2*dpr/roadArt.frameSize[0],4*dpr/(Math.abs(z-nextZ)/12000*roadArt.frameSize[1]));
    const level=roadMips[mipIndex(ratio)];
    road.push({y,z,x:w/2-half,width:half*2,image:level,
      sh:Math.min(level.height,Math.max(1,Math.abs(z-nextZ)/12000*level.height))});
  }
  // Flat front elevations become walls parallel to +Z. Inverse pinhole at each
  // screen column gives texture U; projected world height gives V. No dioramas.
  const facades=[],column=1/dpr;
  for(let side=-1;side<=1;side+=2) for(let offset=column;offset<w/2;offset+=column) {
    const depth=offset/(w*.49),z=projectionZ(depth);
    const nextZ=projectionZ((offset+column)/(w*.49));
    const height=worldHeightPixels(FACADE_HEIGHT,h)*depth;
    const name=side<0?'shops-left':'shops-right';
    const a=manifest.assets[name];
    // Prefilter both axes: distant narrow storefronts must not shimmer.
    const ratio=Math.min(height*dpr/a.frameSize[1],column*dpr/(Math.abs(z-nextZ)/FACADE_LENGTH*a.frameSize[0]));
    const level=mipIndex(ratio);
    facades.push({x:w/2+(side<0?-offset-column:offset),y:horizon+span*depth-height,
      height,z,images:sprites[name].map(frames=>frames[level]),
      sw:Math.min(a.frameSize[0],Math.abs(z-nextZ)/FACADE_LENGTH*a.frameSize[0])});
  }
  return {art,w,h,dpr,sky:sky.canvas,lanes:lanes.canvas,road,roadClip,facades,column,sprites};
}
type Scenery=ReturnType<typeof cacheScenery>;
const sceneryCache=new WeakMap<CanvasRenderingContext2D,Scenery>();
export function prepareRunRenderer(ctx:CanvasRenderingContext2D,art:RunArt,w:number,h:number,dpr:number) {
  sceneryCache.set(ctx,cacheScenery(art,w,h,Math.min(2,dpr)));
}

function sprite(ctx:CanvasRenderingContext2D,c:Scenery,name:AssetName,frame:number,x:number,y:number,scale:number,scaleY=scale) {
  const a=manifest.assets[name],f=a.frames[frame];
  const dw=f.rect[2]*scale,dh=f.rect[3]*scaleY;
  const dx=x-f.anchor[0]*scale,dy=y-f.anchor[1]*scaleY;
  if(dx>c.w||dy>c.h||dx+dw<0||dy+dh<0)return;
  const image=c.sprites[name][frame][mipIndex(Math.min(scale,scaleY)*c.dpr)];
  ctx.drawImage(image,0,0,image.width,image.height,dx,dy,dw,dh);
}

type ObstacleAsset=typeof manifest.assets['bread-cart'];
function groundRow(a:ObstacleAsset,index:number) {
  switch(index){case 0:return 0;case 1:return Math.min(a.heightTop[1],a.groundBack[1]);case 2:return a.groundBack[1];
    case 3:return a.anchor[1];case 4:return a.groundFront[1];default:return a.frameSize[1];}
}
function projectedRow(a:ObstacleAsset,index:number,y:number,scale:number,frontY:number,backY:number) {
  switch(index){case 1:return a.heightTop[1]>=a.groundBack[1]?backY:y+(a.heightTop[1]-a.anchor[1])*scale;case 2:return backY;case 3:return y;case 4:return frontY;
    case 5:return frontY+(a.frameSize[1]-a.groundFront[1])*scale;
    default:return y+(groundRow(a,index)-a.anchor[1])*scale;}
}
/** Five continuous bands preserve both D150 ground endpoints AND physical height.
 * Only the short ground portion gets depth foreshortening, never the whole sprite.
 */
function obstacleSprite(ctx:CanvasRenderingContext2D,c:Scenery,name:AssetName,x:number,y:number,scale:number,frontY:number,backY:number) {
  const a=manifest.assets[name] as ObstacleAsset;
  const x0=x-a.anchor[0]*scale,width=a.frameSize[0]*scale;
  if(x0>c.w||x0+width<0)return;
  for(let band=0;band<5;band++) {
    const sy=groundRow(a,band),ey=groundRow(a,band+1);
    const dy=projectedRow(a,band,y,scale,frontY,backY),end=projectedRow(a,band+1,y,scale,frontY,backY);
    if(ey<=sy||end<=dy||dy>c.h||end<0)continue;
    const image=c.sprites[name][0][mipIndex(Math.min(scale,(end-dy)/(ey-sy))*c.dpr)];
    ctx.drawImage(image,0,sy/a.frameSize[1]*image.height,image.width,(ey-sy)/a.frameSize[1]*image.height,
      x0,dy,width,end-dy+.25);
  }
}

/** Hot path: cached layers, scalar arithmetic, no closures/arrays/DOMMatrix allocations. */
export function renderRun(ctx:CanvasRenderingContext2D,art:RunArt,s:RunState,w:number,h:number,quiet:boolean,crashFrame:number|null=null) {
  let c=sceneryCache.get(ctx);
  if(!c||c.art!==art||c.w!==w||c.h!==h) {
    prepareRunRenderer(ctx,art,w,h,ctx.getTransform().a);c=sceneryCache.get(ctx)!;
  }
  ctx.globalAlpha=1;
  ctx.drawImage(c.sky,0,0,w,h);
  ctx.save();ctx.clip(c.roadClip);
  for(let i=0;i<c.road.length;i++) {
    const row=c.road[i],image=row.image,sy=mod((s.distance+row.z)/12000,1)*image.height;
    const first=Math.min(row.sh,image.height-sy),dh=4.25*first/row.sh;
    ctx.drawImage(image,0,sy,image.width,first,row.x,row.y,row.width,dh);
    if(first<row.sh)ctx.drawImage(image,0,0,image.width,row.sh-first,row.x,row.y+dh,row.width,4.25-dh);
  }
  ctx.restore();
  ctx.drawImage(c.lanes,0,0,w,h);
  for(let i=0;i<c.facades.length;i++) {
    const strip=c.facades[i];
    const u=mod(s.distance+strip.z,FACADE_LENGTH*3)/FACADE_LENGTH;
    const variant=Math.floor(u),image=strip.images[variant],sx=(u-variant)*image.width;
    const sw=Math.max(.01,strip.sw/manifest.assets['shops-left'].frameSize[0]*image.width);
    const first=Math.min(sw,image.width-sx),dw=(c.column+.1)*first/sw;
    ctx.drawImage(image,sx,0,first,image.height,strip.x,strip.y,dw,strip.height);
    if(first<sw) {
      const next=strip.images[(variant+1)%3];
      ctx.drawImage(next,0,0,sw-first,next.height,strip.x+dw,strip.y,c.column+.1-dw,strip.height);
    }
  }
  for(let i=s.objects.length-1;i>=0;i--) {
    const o=s.objects[i],depth=projectionDepth(o.z),name=objectArt[o.kind];
    const x=w/2+(o.lane-1)*w*.27*depth,y=h*(runGeometry.horizon+(runGeometry.feet-runGeometry.horizon)*depth);
    const frame=o.kind==='bread'&&!quiet?Math.floor(s.tick/6)%6:0;
    let scale=(o.kind==='bread'?.65:.52)*w/390*depth;
    if(isRunObstacle(o.kind)) {
      const a=manifest.assets[name];
      if('heightTop' in a) {
        const shape=runGeometry.obstacles[o.kind];
        scale=worldHeightPixels(shape.height,h)*depth/(a.anchor[1]-a.heightTop[1]);
        const frontY=h*(runGeometry.horizon+(runGeometry.feet-runGeometry.horizon)*projectionDepth(o.z-shape.front));
        const backY=h*(runGeometry.horizon+(runGeometry.feet-runGeometry.horizon)*projectionDepth(o.z+shape.back));
        obstacleSprite(ctx,c,name,x,y,scale,frontY,backY);
        continue;
      }
    }
    sprite(ctx,c,name,frame,x,y,scale);
  }
  const change=s.player.laneChange;
  const lane=change?change.from+(change.to-change.from)*change.progress/1000:s.player.lane;
  const x=w/2+(lane-1)*w*.27,y=h*runGeometry.feet;
  let name:AssetName='bunny-run',frame=quiet?0:Math.floor(s.tick*14/60)%8,lift=0;
  if(crashFrame!==null){name='bunny-crash';frame=crashFrame;}
  else if(s.player.pose==='jump'){name='bunny-jump';frame=Math.min(2,Math.floor(s.player.progress*3/1000));lift=worldHeightPixels(jumpLift(s.player.progress),h);}
  else if(s.player.pose==='slide'){name='bunny-slide';frame=s.player.progress<250?0:1;}
  else if(change){name='bunny-lean';frame=change.to<change.from?0:1;}
  const sliding=s.player.pose==='slide'&&crashFrame===null;
  const bodyHeight=sliding?slideBodyHeight(s.player.progress):runGeometry.standingHeight;
  const runFrame=manifest.assets['bunny-run'].frames[0];
  const standingScale=worldHeightPixels(runGeometry.standingHeight,h)/(runFrame.anchor[1]-runFrame.contentBounds[1]);
  if(sliding) {
    const crouch=(runGeometry.standingHeight-bodyHeight)/(runGeometry.standingHeight-runGeometry.slideHeight);
    ctx.globalAlpha=1-crouch;
    sprite(ctx,c,'bunny-run',0,x,y,standingScale,worldHeightPixels(bodyHeight,h)/(runFrame.anchor[1]-runFrame.contentBounds[1]));
    ctx.globalAlpha=crouch;
  }
  const f=manifest.assets[name].frames[frame];
  const scaleY=worldHeightPixels(bodyHeight,h)/(f.anchor[1]-f.contentBounds[1]);
  sprite(ctx,c,name,frame,x,y-lift,sliding?standingScale:scaleY,scaleY);
  ctx.globalAlpha=1;
}

/** Billboards use pinhole height, never a depth derivative (which grows squared).
 * Ground contact endpoints remain independent projections of the replay footprint.
 */
export function obstaclePlacement(kind:keyof typeof runGeometry.obstacles,lane:number,z:number,w:number,h:number) {
  const asset=manifest.assets[objectArt[kind]];
  if(!('heightTop' in asset))throw new Error('Missing RUN geometry');
  const shape=runGeometry.obstacles[kind],depth=projectionDepth(z);
  const ground=(distance:number)=>h*(runGeometry.horizon+(runGeometry.feet-runGeometry.horizon)*projectionDepth(distance));
  return {x:w/2+(lane-1)*w*.27*depth,y:ground(z),
    scale:worldHeightPixels(shape.height,h)*depth/(asset.anchor[1]-asset.heightTop[1]),
    frontY:ground(z-shape.front),backY:ground(z+shape.back)};
}

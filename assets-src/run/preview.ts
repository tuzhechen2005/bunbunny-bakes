/** Offline visual QA of the actual Canvas renderer. No browser, no runtime dependency. */
import { createRequire } from 'node:module';
import { writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { manifest, type RunArt } from '../../src/components/run/runAssets';
import { prepareRunRenderer, renderRun } from '../../src/components/run/runRenderer';
import { createRunGame } from '../../src/lib/run';

async function main() {
  const require=createRequire(resolve('assets-src/run/.cache/preview/package.json'));
  const {createCanvas,loadImage,Path2D}=require('@napi-rs/canvas');
  Object.defineProperty(globalThis,'Path2D',{value:Path2D,configurable:true});
  Object.defineProperty(globalThis,'document',{value:{createElement:()=>createCanvas(1,1)},configurable:true});
  const art={} as RunArt;
  for(const name of Object.keys(manifest.assets) as (keyof RunArt)[]) {
    art[name]=await loadImage(resolve('public/brand/run',manifest.assets[name].file));
  }
  const game=createRunGame({seed:'v3.preview',realtime:true});
  const state=game.frame(0);
  state.objects=[{id:1,lane:0,z:500,kind:'cart'},{id:2,lane:2,z:14000,kind:'flour'},
    {id:3,lane:0,z:36000,kind:'awning'}, {id:4,lane:1,z:10000,kind:'bread'},
    {id:5,lane:1,z:17000,kind:'bread'},{id:6,lane:1,z:24000,kind:'bread'}];
  state.objects.sort((a,b)=>a.z-b.z);
  const layers=[];
  const times:number[]=[];
  for(const [index,width] of [320,390].entries()) {
    const canvas=createCanvas(width*2,650*2),ctx=canvas.getContext('2d');
    ctx.setTransform(2,0,0,2,0,0);
    prepareRunRenderer(ctx,art,width,650,2);
    state.distance=index*5300;state.tick=index*4;
    renderRun(ctx,art,state,width,650,false);
    await writeFile(resolve(`assets-src/run/.cache/street-${width}.png`),canvas.toBuffer('image/png'));
    layers.push({input:await sharp(canvas.toBuffer('image/png')).resize(width,650).png().toBuffer(),left:20+index*340,top:55});
    if(width===390)for(let i=0;i<240;i++) {
      state.distance=i*220;state.tick=i;
      const start=performance.now();renderRun(ctx,art,state,width,650,false);
      times.push(performance.now()-start);
    }
  }
  const sheet=await readFile('assets-src/run/.cache/contact-sheet.png');
  layers.push({input:await sharp(sheet).resize(800,1020).png().toBuffer(),left:780,top:0});
  layers.push({input:Buffer.from('<svg width="1600" height="1020"><text x="20" y="30" font-family="sans-serif" font-size="19" fill="#66523f">R6 / Actual renderer · 320 + 390 CSS px · DPR 2</text><text x="20" y="750" font-family="sans-serif" font-size="18" fill="#66523f">Rear courier / continuous street-facing facades / pinhole depth</text></svg>'),left:0,top:0});
  await sharp({create:{width:1600,height:1020,channels:4,background:'#f4ebdd'}}).composite(layers).png().toFile('assets-src/run/preview.png');
  times.sort((a,b)=>a-b);
  console.log(`Offline CPU canvas, 390x650 DPR 2, 240 draws: median ${times[120].toFixed(2)} ms, p95 ${times[228].toFixed(2)} ms. This is not a WeChat/phone FPS measurement.`);
}
void main();

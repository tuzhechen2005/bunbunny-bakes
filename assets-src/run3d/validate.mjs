// Asset contract checks, independent of the procedural Blender source.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
let validator;try { validator=require('./.cache/validator/node_modules/gltf-validator'); } catch {}
const dir=path.resolve('public/brand/run3d');
const expected={props:['cart','flour','awning','puddle','ramp','van','truck','bread','bag','coffee','lamp','tree','bench'],town:['bakery','cafe','flower_shop','book_shop','house_rose','house_sage','sidewalk','road']};
const report={}; let total=0;
for(const name of ['bunny','props','town']) {
 const bytes=fs.readFileSync(path.join(dir,name+'.glb'));total+=bytes.length;
 assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(4),2);assert.equal(bytes.readUInt32LE(8),bytes.length);
 const jsonLength=bytes.readUInt32LE(12),g=JSON.parse(bytes.subarray(20,20+jsonLength).toString());
 const bin=bytes.subarray(28+jsonLength);
 assert(!g.extensionsUsed?.includes('KHR_draco_mesh_compression'));assert(!g.images?.length);assert(!g.buffers.some(b=>b.uri));
 const tris=g.meshes.reduce((sum,m)=>sum+m.primitives.reduce((s,p)=>s+g.accessors[p.indices].count/3,0),0);
 const roots=g.scenes[g.scene].nodes.map(i=>g.nodes[i]);
 function values(index){const a=g.accessors[index],v=g.bufferViews[a.bufferView],n={SCALAR:1,VEC3:3,VEC4:4}[a.type];assert.equal(a.componentType,5126);return Array.from({length:a.count},(_,i)=>Array.from({length:n},(_,j)=>bin.readFloatLE((v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||n*4)+j*4)));}
 const dimensions={};
 // Exported static roots and mesh children are unrotated; exporter bakes Y-up geometry.
 for(const root of roots){
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  function visit(o,offset=[0,0,0]){
   assert(!o.matrix,`Unexpected matrix on ${o.name}`);
   if(o.rotation)assert(o.rotation.every((v,i)=>Math.abs(v-[0,0,0,1][i])<1e-5),`Unexpected rotation on ${o.name}`);
   const t=offset.map((v,i)=>v+(o.translation?.[i]||0));
   if(o.mesh!==undefined)for(const p of g.meshes[o.mesh].primitives){const a=g.accessors[p.attributes.POSITION];for(let i=0;i<3;i++){lo[i]=Math.min(lo[i],a.min[i]+t[i]);hi[i]=Math.max(hi[i],a.max[i]+t[i]);}}
   for(const child of o.children||[])if(name!=='bunny'||g.nodes[child].name!=='BunnyRig')visit(g.nodes[child],t);
  }
  visit(root);if(!Number.isFinite(lo[0]))continue;dimensions[root.name]={min:lo,max:hi,size:hi.map((v,i)=>+(v-lo[i]).toFixed(4))};
 }
 if(expected[name])assert.deepEqual(roots.map(o=>o.name).sort(),expected[name].sort());
 if(name==='bunny'){
  assert(tris>=3000&&tris<=5000,`Bunny triangles ${tris}`);assert.equal(g.skins.length,1);
  assert.deepEqual(g.animations.map(a=>a.name).sort(),['run','jump','slide','leanL','leanR','crash','idle'].sort());
  for(const animation of g.animations){
   if(animation.name==='run')assert(g.accessors[animation.samplers[0].input].count>=16);
   if(['run','slide','idle'].includes(animation.name))for(const sampler of animation.samplers){const v=values(sampler.output);assert(v[0].every((x,i)=>Math.abs(x-v.at(-1)[i])<1e-5),`${animation.name} loop seam`);}
  }
  assert(Math.abs(dimensions.BunnyClay.size[1]-1.6)<.02);assert(Math.abs(dimensions.BunnyClay.min[1])<.001);
 }
 const near=(n,axis,v)=>assert(Math.abs(dimensions[n].size[axis]-v)<.025,`${n} dimension`);
 if(name==='props'){near('cart',0,1.8);near('cart',1,1.4);near('flour',1,.9);near('bread',0,.45);near('ramp',2,2);near('ramp',1,1.3);for(const n of ['van','truck']){assert(Math.abs(dimensions[n].max[1]-1.3)<.001);near(n,0,1.9);assert(dimensions[n].size[2]<6.2);}}
 if(name==='town'){near('road',0,8);near('road',2,6);near('sidewalk',0,2);near('sidewalk',2,6);for(const n of expected.town.filter(n=>!['road','sidewalk'].includes(n))){near(n,0,6);near(n,1,7);}}
 let validation={status:'not installed'};
 if(validator){const v=await validator.validateBytes(new Uint8Array(bytes),{uri:name+'.glb',maxIssues:1000});validation=v.issues;assert.equal(v.issues.numErrors,0,JSON.stringify(v.issues));assert.equal(v.issues.numWarnings,0,JSON.stringify(v.issues));}
 report[name]={bytes:bytes.length,triangles:tris,dimensions,animations:g.animations?.map(a=>({name:a.name,keyframes:g.accessors[a.samplers[0].input].count})),validation};
}
const preview=fs.statSync(path.join(dir,'preview.png')).size;
assert(total+preview<=1500000,`Budget exceeded: ${total+preview}`);
report.totalGlbBytes=total;report.previewBytes=preview;report.totalDeliveryBytes=total+preview;
fs.writeFileSync('assets-src/run3d/validation.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));

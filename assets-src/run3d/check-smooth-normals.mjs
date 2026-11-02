// Inspect the actual meshopt-decoded delivery, including quantized normals.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {io} from './compress.mjs';
const doc=await io.read('public/brand/run3d/props.glb');
const rows=[];
for(const name of ['tree','tree_round2','tree_tall','planter','bread','bag','crate_stack','puddle']){
 const node=doc.getRoot().listNodes().find(n=>n.getName()===name+'Mesh');
 let triangles=0,flat=0,seams=0,maxSeamAngle=0;
 for(const p of doc.getRoot().listNodes().find(n=>n.getName()===name+'Mesh').getMesh().listPrimitives()){
  const pos=p.getAttribute('POSITION'),normal=p.getAttribute('NORMAL'),indices=p.getIndices();
  assert(normal,`${name}: missing NORMAL in packed GLB`);
  const world=node.getWorldMatrix();
  const lower=i=>{const v=pos.getElement(i,[]);return world[1]*v[0]+world[5]*v[1]+world[9]*v[2]+world[13]<.9;};
  const unit=i=>{const v=normal.getElement(i,[]),len=Math.hypot(...v);assert(len>.9&&len<1.1);return v.map(x=>x/len);};
  const angle=(a,b)=>Math.acos(Math.max(-1,Math.min(1,a.reduce((sum,x,i)=>sum+x*b[i],0))))*180/Math.PI;
  const shared=new Map();
  for(let i=0;i<pos.getCount();i++){
   const key=pos.getElement(i,[]).join(','),n=unit(i);
   if(name.startsWith('tree')&&lower(i))continue;
   if(shared.has(key)){seams++;maxSeamAngle=Math.max(maxSeamAngle,angle(n,shared.get(key)));}else shared.set(key,n);
  }
  for(let i=0;i<indices.getCount();i+=3){
   const a=unit(indices.getScalar(i)),b=unit(indices.getScalar(i+1)),c=unit(indices.getScalar(i+2));
   triangles++;if(angle(a,b)<.1&&angle(a,c)<.1)flat++;
  }
 }
 // Leaves remain smooth; intentional pot/lower-trunk creases are exempt from seam checks.
 if(name.startsWith('tree'))assert(flat/triangles<.02,`${name}: flat shading`);
 assert(maxSeamAngle<1,`${name}: split normals`);
 rows.push({name,triangles,flatTriangles:flat,coincidentVertices:seams,maxSeamAngleDegrees:maxSeamAngle});
}
await fs.writeFile('assets-src/run3d/review/smooth-normals.json',JSON.stringify({sourceSha256:createHash('sha256').update(await fs.readFile('public/brand/run3d/props.glb')).digest('hex'),meshes:rows},null,2)+'\n');
console.table(rows);

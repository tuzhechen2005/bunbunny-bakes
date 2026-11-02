// Replace geometry only: baseline nodes, materials, extras, rig and animation
// samplers remain authoritative. Keep one primitive per existing material.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {io,decode} from './compress.mjs';
import {dequantize,mergeDocuments,transformPrimitive,prune,dedup,unpartition,meshopt} from './.cache/tools/node_modules/@gltf-transform/functions/dist/functions.modern.js';
import {MeshoptEncoder} from './.cache/tools/node_modules/meshoptimizer/index.module.js';
import {mat4} from './.cache/tools/node_modules/gl-matrix/esm/index.js';
const dir='assets-src/run3d/.cache';
const table=[];
const triangles=n=>{let sum=0;n.traverse(x=>{for(const p of x.getMesh()?.listPrimitives()||[])sum+=p.getIndices().getCount()/3;});return sum;};
for(const name of ['town','props','bunny']){
 const doc=await io.read(`${dir}/baseline/${name}.glb`);
 doc.getRoot().listExtensionsUsed().find(e=>e.extensionName==='EXT_meshopt_compression')?.dispose();
 await doc.transform(dequantize());
 const source=await io.read(`${dir}/performance/${name}.glb`);
 const oldNodes=doc.getRoot().listNodes().filter(n=>n.getMesh());
 if(name==='town'){
  const street=await io.read(`${dir}/performance/street.glb`);
  const mapping=mergeDocuments(source,street);
  for(const root of street.getRoot().getDefaultScene().listChildren()){
   const original=source.getRoot().getDefaultScene().listChildren().find(n=>n.getName()===root.getName());
   for(const child of original.listChildren())child.dispose();original.dispose();
   source.getRoot().getDefaultScene().addChild(mapping.get(root));
  }
  mapping.get(street.getRoot().getDefaultScene()).dispose();
 }
 const map=mergeDocuments(doc,source);
 for(const node of oldNodes){
  const src=source.getRoot().listNodes().find(n=>n.getName()===node.getName());assert(src, node.getName());
  const copy=map.get(src);const before=triangles(node);
  const old=node.getMesh(),fresh=copy.getMesh();
  assert.equal(fresh.listPrimitives().length,old.listPrimitives().length,node.getName());
  let matrix;
  if(node.getSkin()){
   const a=node.getSkin(),b=copy.getSkin();assert(b);
   const oldJoints=a.listJoints().map(j=>j.getName());
   const newJoints=b.listJoints().map(j=>j.getName());
   matrix=mat4.multiply([],mat4.invert([],a.getInverseBindMatrices().getElement(oldJoints.indexOf(newJoints[0]),[])),b.getInverseBindMatrices().getElement(0,[]));
   for(const p of fresh.listPrimitives()){
    const joints=p.getAttribute('JOINTS_0');const arr=joints.getArray();
    for(let i=0;i<arr.length;i++){arr[i]=oldJoints.indexOf(newJoints[arr[i]]);assert(arr[i]>=0);}
   }
  }else matrix=mat4.multiply([],mat4.invert([],node.getWorldMatrix()),copy.getWorldMatrix());
  const oldPrims=old.listPrimitives();
  for(const [i,p] of fresh.listPrimitives().entries()){
   assert(p.getAttribute('NORMAL'),`${name}/${node.getName()}: source export missing NORMAL`);
   transformPrimitive(p,matrix);
   // Match material by properties/name (water is the sole second material).
   const material=oldPrims.find(q=>Math.abs(q.getMaterial().getRoughnessFactor()-p.getMaterial().getRoughnessFactor())<1e-6)?.getMaterial();
   assert(material);p.setMaterial(material);
   old.removePrimitive(oldPrims[i]);old.addPrimitive(p);
  }
  // Preserve each placement envelope exactly, including ground and roof anchors.
  const box=prims=>{const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
   for(const p of prims){const a=p.getAttribute('POSITION');for(let i=0;i<a.getCount();i++){
    const v=a.getElement(i,[]);for(let d=0;d<3;d++){lo[d]=Math.min(lo[d],v[d]);hi[d]=Math.max(hi[d],v[d]);}
   }}return {lo,hi};};
  const a=box(oldPrims),b=box(old.listPrimitives()),fit=mat4.create();
  for(let d=0;d<3;d++){fit[d*5]=(a.hi[d]-a.lo[d])/(b.hi[d]-b.lo[d]);fit[12+d]=a.lo[d]-b.lo[d]*fit[d*5];}
  for(const p of old.listPrimitives())transformPrimitive(p,fit);
  table.push({file:name,node:node.getName(),before,after:triangles(node)});
 }
 // Dispose only imported copies, preserving every original node and its name.
 for(const node of source.getRoot().listNodes())map.get(node).dispose();
 for(const scene of source.getRoot().listScenes())map.get(scene).dispose();
 await doc.transform(prune({keepAttributes:true,keepLeaves:true}),unpartition(),dedup({propertyTypes:['Accessor']}));
 await doc.transform(meshopt({encoder:MeshoptEncoder,level:name==='bunny'?'medium':'high',quantizePosition:name==='town'?14:16,quantizeNormal:name==='town'?8:12,quantizeColor:8,quantizeWeight:8,cleanup:true}));
 await io.write(`public/brand/run3d/${name}.glb`,doc);await decode(name);
 const shipped=await io.read(`public/brand/run3d/${name}.glb`);
 for(const mesh of shipped.getRoot().listMeshes())for(const p of mesh.listPrimitives())
  assert(p.getAttribute('NORMAL'),`${name}/${mesh.getName()}: packed output missing NORMAL`);
 for(const row of table.filter(r=>r.file===name))row.after=triangles(shipped.getRoot().listNodes().find(n=>n.getName()===row.node));
}
console.table(table);
await fs.writeFile('assets-src/run3d/review/triangles.json',JSON.stringify(table,null,2)+'\n');

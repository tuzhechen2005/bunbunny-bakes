// Validate delivered compressed bytes AND their full decoded geometry.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {io} from './compress.mjs';
const require=createRequire(import.meta.url);
const validator=require('./.cache/tools/node_modules/gltf-validator');
const here=path.resolve('assets-src/run3d'),dir=path.resolve('public/brand/run3d');
const facades=['bakery','cafe','flower_shop','book_shop','house_rose','house_sage','patisserie','cheese_shop','tea_house','corner_house'];
const props=['cart','flour','awning','puddle','ramp','van','truck','bread','bag','coffee','lamp','tree','bench','pothole','breadwheel','shoes','shield','signal','planter','bicycle','crate_stack','menu_board','bunting','tree_round2','tree_tall'];
const expected={bunny:['BunnyClay','BunnyRig'],props,town:[...facades,'sidewalk','road']};
const sha=b=>createHash('sha256').update(b).digest('hex');
const near=(a,b,tol=.025,label='dimension')=>assert(Math.abs(a-b)<=tol,`${label}: ${a} vs ${b}`);
const report={};
const poseLog=fs.readFileSync(path.join(here,'.cache/poses.log'),'utf8');
const poseHash=poseLog.match(/POSE_ASSET_SHA256=([a-f0-9]{64})/)?.[1];
const poseReport=JSON.parse(poseLog.match(/POSE_REPORT=(.+)/)[1]);
assert.equal(poseHash,sha(fs.readFileSync(path.join(dir,'bunny.glb'))));
assert.equal(poseLog.match(/POSE_DECODED_SHA256=([a-f0-9]{64})/)?.[1],sha(fs.readFileSync(path.join(here,'.cache/decoded/bunny.glb'))));
assert.equal(Object.keys(poseReport).length,7);

function point(m,p){return [0,1,2].map(i=>m[i]*p[0]+m[i+4]*p[1]+m[i+8]*p[2]+m[i+12]);}
function bounds(root){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let triangles=0;
  root.traverse(node=>{
    if(!node.getMesh())return;
    const skin=node.getSkin(),world=node.getWorldMatrix();
    const joints=skin?.listJoints(),ibm=skin?.getInverseBindMatrices();
    for(const p of node.getMesh().listPrimitives()){
      assert.equal(p.getMode(),4);triangles+=p.getIndices().getCount()/3;
      const pos=p.getAttribute('POSITION'),j=p.getAttribute('JOINTS_0'),w=p.getAttribute('WEIGHTS_0');
      for(let i=0;i<pos.getCount();i++){
        const v=pos.getElement(i,[]);let q;
        if(skin){
          const indices=j.getElement(i,[]),weights=w.getElement(i,[]);q=[0,0,0];
          near(weights.reduce((a,b)=>a+b,0),1,1e-5,'Skin weights');
          for(let k=0;k<4;k++)if(weights[k]){
            const b=point(ibm.getElement(indices[k],[]),v),a=point(joints[indices[k]].getWorldMatrix(),b);
            for(let d=0;d<3;d++)q[d]+=a[d]*weights[k];
          }
        }else q=point(world,v);
        assert(q.every(Number.isFinite),'Nonfinite geometry');
        for(let d=0;d<3;d++){min[d]=Math.min(min[d],q[d]);max[d]=Math.max(max[d],q[d]);}
      }
    }
  });
  return {triangles,...(triangles?{min,max,size:max.map((v,i)=>+(v-min[i]).toFixed(5))}:{})};
}
async function validateBytes(bytes,uri){
  const {issues}=await validator.validateBytes(new Uint8Array(bytes),{uri,maxIssues:1000});
  assert.equal(issues.numErrors,0,JSON.stringify({uri,...issues}));
  assert.equal(issues.numWarnings,0,JSON.stringify({uri,...issues}));
  return issues;
}
for(const name of ['bunny','props','town']){
  const bytes=fs.readFileSync(path.join(dir,name+'.glb'));
  assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(4),2);assert.equal(bytes.readUInt32LE(8),bytes.length);
  const g=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
  assert(g.extensionsRequired.includes('EXT_meshopt_compression'));
  assert(g.extensionsRequired.includes('KHR_mesh_quantization'));
  assert(!g.images?.length);assert(g.buffers.every(b=>!b.uri));
  assert(g.bufferViews.some(v=>v.extensions?.EXT_meshopt_compression));
  if(name!=='bunny'){
    const used=new Set(g.meshes.flatMap(m=>m.primitives.flatMap(p=>[p.indices,...Object.values(p.attributes)])));
    assert.equal(used.size,g.accessors.length,'Orphaned static accessor wastes delivery bytes');
  }
  const doc=await io.read(path.join(dir,name+'.glb')),root=doc.getRoot();
  const roots=root.getDefaultScene().listChildren();
  assert.deepEqual(roots.map(n=>n.getName()).sort(),expected[name].slice().sort());
  for(const node of roots){
    assert.deepEqual(node.getTranslation(),[0,0,0],node.getName());
    assert.deepEqual(node.getScale(),[1,1,1],node.getName());
    assert.deepEqual(node.getRotation(),[0,0,0,1],node.getName());
    if(name!=='bunny'){
      assert.equal(node.listChildren().length,1);
      assert.equal(node.listChildren()[0].getName(),node.getName()+'Mesh');
    }
  }
  for(const mat of root.listMaterials()){
    assert([.75,.05].some(r=>Math.abs(mat.getRoughnessFactor()-r)<1e-6));
    assert.equal(mat.getAlphaMode(),'OPAQUE');
  }
  for(const mesh of root.listMeshes())for(const p of mesh.listPrimitives()){
    const c=p.getAttribute('COLOR_0');assert(c,'Missing baked vertex pigment');
    assert.equal(c.getComponentType(),5121);assert(c.getNormalized());
    assert.notEqual(p.getAttribute('POSITION').getComponentType(),5126,'Positions must be quantized');
    assert(new Set(c.getArray()).size>12,'Pigment lacks variation');
  }
  const dimensions=Object.fromEntries(roots.map(n=>[n.getName(),bounds(n)]));
  const triangles=Object.values(dimensions).reduce((a,b)=>a+b.triangles,0);
  if(name==='bunny'){
    assert.equal(sha(bytes),sha(fs.readFileSync(path.join(here,'.cache/baseline/bunny.glb'))),'R17 must leave bunny bytes unchanged');
    assert(triangles>=25000&&triangles<=35000);
    assert.equal(root.listSkins().length,1);
    assert.deepEqual(root.listSkins()[0].listJoints().map(n=>n.getName()).sort(),['body','head','earL','earR','legL','legR','armL','armR'].sort());
    near(dimensions.BunnyClay.size[1],1.6,.002);near(dimensions.BunnyClay.min[1],0,.0002);
    const names=['run','jump','slide','leanL','leanR','crash','idle'];
    assert.deepEqual(root.listAnimations().map(a=>a.getName()).sort(),names.sort());
    const baseline=await io.read(path.join(here,'.cache/baseline/bunny.glb'));
    const actions=[];
    for(const animation of root.listAnimations()){
      const old=baseline.getRoot().listAnimations().find(a=>a.getName()===animation.getName());
      assert.equal(animation.listChannels().length,old.listChannels().length);
      let maxAnimationDelta=0;
      for(const channel of animation.listChannels()){
        const before=old.listChannels().find(c=>c.getTargetNode().getName()===channel.getTargetNode().getName()&&c.getTargetPath()===channel.getTargetPath());
        assert(before);const a=channel.getSampler(),b=before.getSampler();
        assert.equal(a.getInterpolation(),b.getInterpolation());
        for(const property of ['getInput','getOutput']){
          const aa=a[property]().getArray(),bb=b[property]().getArray();assert.equal(aa.length,bb.length);
          for(let i=0;i<aa.length;i++)maxAnimationDelta=Math.max(maxAnimationDelta,Math.abs(aa[i]-bb[i]));
        }
        if(['run','slide','idle'].includes(animation.getName())){
          const output=a.getOutput(),first=output.getElement(0,[]),last=output.getElement(output.getCount()-1,[]);
          first.forEach((v,i)=>near(v,last[i],1e-5,'Loop endpoint'));
        }
      }
      assert(maxAnimationDelta<1e-5,`${animation.getName()} changed: ${maxAnimationDelta}`);
      const sampler=animation.listSamplers()[0];
      actions.push({name:animation.getName(),keyframes:sampler.getInput().getCount(),duration:Math.max(...sampler.getInput().getArray()),maxDeltaFromBaseline:maxAnimationDelta});
    }
    report.actions=actions;
  }
  if(name==='props'){
    for(const n of ['tree','tree_round2','tree_tall']){
      const tree=roots.find(r=>r.getName()===n);
      assert.equal(tree.getExtras().foliageClumps,5);
      near(dimensions[n].min[1],0,.0002,`${n} ground`);
      near(dimensions[n].max[1],2.66,.12,`${n} height`);
    }
    for(const n of ['tree','tree_round2']){
      near(dimensions[n].size[0],1.64,.001,n+' width');
      near(dimensions[n].size[2],1.31,.001,n+' depth');
    }
    assert(dimensions.tree_tall.size[0]<1.05,'Cypress should be slender');
    near(dimensions.puddle.size[0],1.7,.0002,'Puddle footprint width');
    near(dimensions.puddle.size[2],1.1,.0002,'Puddle footprint depth');
    assert(dimensions.puddle.max[1]<=.0241);
    const waterRoot=roots.find(n=>n.getName()==='puddle');
    assert.deepEqual(waterRoot.getExtras().rippleRadii,[.28,.51,.74]);
    const waterNode=waterRoot.listChildren()[0];
    const water=waterNode.getMesh().listPrimitives().find(p=>p.getMaterial().getRoughnessFactor()<.1);
    assert(water,'Puddle requires a separate water material');
    near(water.getMaterial().getRoughnessFactor(),.05,1e-8,'Water roughness');
    near(water.getMaterial().getMetallicFactor(),.15,1e-8,'Water metalness');
    const inner=[],outer=[];
    for(let i=0;i<water.getAttribute('POSITION').getCount();i++){
      const p=point(waterNode.getWorldMatrix(),water.getAttribute('POSITION').getElement(i,[]));
      const rad=Math.hypot(p[0]/.80,p[2]/.52);
      const c=water.getAttribute('COLOR_0').getElement(i,[]);
      if(rad<.12)inner.push({p,c});if(rad>.90)outer.push({p,c});
    }
    assert(inner.length>0&&outer.length>0);
    const avg=(arr,f)=>arr.reduce((a,v)=>a+f(v),0)/arr.length;
    assert(avg(outer,v=>v.p[1])-avg(inner,v=>v.p[1])>.007,'Water must be concave');
    assert(avg(outer,v=>v.c[1])-avg(inner,v=>v.c[1])>.15,'Water must lighten toward its edge');
    assert(avg(inner,v=>v.c[2])>avg(inner,v=>v.c[0]),'Deep teal-blue centre');
    for(const [n,d] of Object.entries(dimensions))assert(d.triangles>=2000&&d.triangles<=8000,`${n}: ${d.triangles} triangles`);
    for(const [n,axis,value] of [['cart',0,1.8],['cart',1,1.4],['flour',1,.9],['bread',0,.45],['ramp',0,1.7],['ramp',1,1.3],['ramp',2,2],['pothole',0,1.6],['pothole',2,1.6],['breadwheel',1,1.2],['breadwheel',2,1.2]])near(dimensions[n].size[axis],value,.025,n);
    for(const n of ['van','truck']){near(dimensions[n].max[1],1.3,.001);near(dimensions[n].size[0],1.9);near(dimensions[n].size[2],6);}
    for(const n of ['pothole','breadwheel','shoes','shield','signal','planter','crate_stack','menu_board'])near(dimensions[n].min[1],0,.008,`${n} ground`);
    assert(dimensions.pothole.size[1]<.08);assert(dimensions.signal.size[1]<.35);
    const previous=await io.read(path.join(here,'.cache/baseline/props.glb'));
    const changed=new Set(['tree','puddle','planter','cart','awning','tree_round2','tree_tall']);
    for(const old of previous.getRoot().getDefaultScene().listChildren()){
      if(changed.has(old.getName()))continue;
      const before=bounds(old),after=dimensions[old.getName()];
      assert.equal(after.triangles,before.triangles,`${old.getName()} unchanged triangles`);
      for(let axis=0;axis<3;axis++){
        near(after.min[axis],before.min[axis],.0002,`${old.getName()} unchanged min`);
        near(after.max[axis],before.max[axis],.0002,`${old.getName()} unchanged max`);
      }
    }
    const bunting=roots.find(n=>n.getName()==='bunting');
    assert.equal(bunting.getExtras().anchor,'midpoint between attachment ends');
    assert.deepEqual(bunting.getExtras().attachmentEnds,[-4,0,0,4,0,0]);
    near(dimensions.bunting.size[0],8,.04);assert(dimensions.bunting.min[1]>-.85);
  }
  if(name==='town'){
    for(const n of facades){near(dimensions[n].size[0],6);near(dimensions[n].size[1],7);assert(dimensions[n].max[2]<2.66);}
    for(const [n,w] of [['road',8],['sidewalk',2]]){near(dimensions[n].size[0],w,.001);near(dimensions[n].size[2],6,.001);}
    near(dimensions.road.max[1],.024,.0002);
  }
  const validation=await validateBytes(bytes,name+'.glb');
  const decodedValidation=await validateBytes(fs.readFileSync(path.join(here,'.cache/decoded',name+'.glb')),'decoded-'+name+'.glb');
  report[name]={bytes:bytes.length,sha256:sha(bytes),triangles,dimensions,validation,decodedValidation};
}
const files=fs.readdirSync(dir,{recursive:true}).filter(n=>fs.statSync(path.join(dir,n)).isFile());
const total=files.reduce((sum,n)=>sum+fs.statSync(path.join(dir,n)).size,0);
assert(total<=4200000,`Public budget exceeded: ${total}`);
const previews=['preview.png','bunny-closeup.png','props-review.png','facades-review.png','mechanics-preview.png','trees-closeup.png','puddle-closeup.png','planting-closeup.png'];
const provenance=JSON.parse(fs.readFileSync(path.join(here,'.cache/preview-provenance.json')));
for(const name of ['bunny','props','town'])assert.equal(provenance.sourceSha256[name],report[name].sha256);
report.previews=Object.fromEntries(previews.map(n=>{const bytes=fs.readFileSync(path.join(here,n));assert.equal(bytes.readUInt32BE(0),0x89504e47);return [n,{bytes:bytes.length,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:sha(bytes)}];}));
report.totalPublicBytes=total;report.budgetBytes=4200000;
report.facadeOptimization={targetTriangleRatio:.94,relativeErrorLimit:.00008,lockedBorders:true,excludes:['road','sidewalk','all props','bunny']};
report.compression='EXT_meshopt_compression + KHR_mesh_quantization. Bunny: 16-bit positions/12-bit normals; props: 16-bit positions/8-bit octahedral normals; town: 14-bit positions/8-bit octahedral normals. All: 8-bit vertex colours/weights. MeshoptDecoder required.';
const loaderCheck=JSON.parse(fs.readFileSync(path.join(here,'.cache/loader-check.json')));
for(const name of ['bunny','props','town'])assert.equal(loaderCheck[name].sha256,report[name].sha256);
assert.equal(loaderCheck.bunny.animationPoses,175);
report.threeLoaderValidation=loaderCheck;
report.poseValidation={assetSha256:poseHash,samplingIntervalFrames:.5,actions:poseReport};
report.previewProvenance=provenance;
fs.writeFileSync(path.join(here,'validation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({totalPublicBytes:total,budgetBytes:4200000,models:Object.fromEntries(['bunny','props','town'].map(n=>[n,{bytes:report[n].bytes,triangles:report[n].triangles,errors:report[n].validation.numErrors,warnings:report[n].validation.numWarnings}]))},null,2));

// R17: replace only authored roots; preserve every other delivered prop and bunny.
import fs from 'node:fs/promises';
import {io,decode} from './compress.mjs';
import {dequantize,mergeDocuments,unpartition,dedup,prune,meshopt,simplifyPrimitive} from './.cache/tools/node_modules/@gltf-transform/functions/dist/functions.modern.js';
import {MeshoptEncoder,MeshoptSimplifier} from './.cache/tools/node_modules/meshoptimizer/index.module.js';
const dir='assets-src/run3d/.cache',out='public/brand/run3d';
if(process.argv.includes('--decode')){
  for(const n of ['bunny','props','town'])await decode(n);
}else{
  for(const n of (process.argv.slice(2).length?process.argv.slice(2):['props','town'])){
    const doc=await io.read(`${dir}/${n==='props'?'baseline/props':'raw/town'}.glb`);
    if(n==='props'){
      doc.getRoot().listExtensionsUsed().find(e=>e.extensionName==='EXT_meshopt_compression')?.dispose();
      await doc.transform(dequantize());
      const source=await io.read(`${dir}/raw/nature-props.glb`),scene=doc.getRoot().getDefaultScene();
      for(const replacement of source.getRoot().getDefaultScene().listChildren()){
        const old=scene.listChildren().find(x=>x.getName()===replacement.getName());
        if(old){for(const child of old.listChildren())child.dispose();old.dispose();}
      }
      const map=mergeDocuments(doc,source),copy=map.get(source.getRoot().getDefaultScene());
      for(const child of copy.listChildren())scene.addChild(child);
      copy.dispose();
    }
    if(n==='town'){
      // Trim redundant facade triangles under a sub-millimetre error bound.
      // Infrastructure, all props, pigments and quantization precision stay intact.
      await MeshoptSimplifier.ready;
      for(const root of doc.getRoot().getDefaultScene().listChildren()){
        if(['road','sidewalk'].includes(root.getName()))continue;
        root.traverse(node=>{for(const p of node.getMesh()?.listPrimitives()||[])
          simplifyPrimitive(p,{simplifier:MeshoptSimplifier,ratio:.94,error:.00008,lockBorder:true});
        });
      }
    }
    await doc.transform(prune({keepAttributes:true,keepLeaves:true}),unpartition(),dedup({propertyTypes:['Accessor','Material']}));
    await doc.transform(meshopt({encoder:MeshoptEncoder,level:'high',quantizePosition:n==='town'?14:16,quantizeNormal:8,quantizeColor:8,cleanup:true}));
    await io.write(`${out}/${n}.glb`,doc);await decode(n);
    console.log(n,(await fs.stat(`${out}/${n}.glb`)).size);
  }
  await decode('bunny');
}

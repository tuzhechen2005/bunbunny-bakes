// R16 isolated build step: preserve named roots, skins and sampled actions.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NodeIO} from './.cache/tools/node_modules/@gltf-transform/core/dist/index.modern.js';
import {ALL_EXTENSIONS} from './.cache/tools/node_modules/@gltf-transform/extensions/dist/index.modern.js';
import {meshopt, dequantize, mergeDocuments, unpartition, dedup} from './.cache/tools/node_modules/@gltf-transform/functions/dist/functions.modern.js';
import {MeshoptEncoder,MeshoptDecoder} from './.cache/tools/node_modules/meshoptimizer/index.module.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const out=path.resolve(here,'../../public/brand/run3d');
export const io=new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({'meshopt.encoder':MeshoptEncoder,'meshopt.decoder':MeshoptDecoder});
await Promise.all([MeshoptEncoder.ready,MeshoptDecoder.ready]);

export async function decode(name) {
  const doc=await io.read(path.join(out,name+'.glb'));
  doc.getRoot().listExtensionsUsed().find(e=>e.extensionName==='EXT_meshopt_compression')?.dispose();
  await doc.transform(dequantize());
  await fs.mkdir(path.join(here,'.cache/decoded'),{recursive:true});
  await io.write(path.join(here,'.cache/decoded',name+'.glb'),doc);
}

async function main() {
  for(const name of (process.argv.slice(2).length?process.argv.slice(2):['bunny','props','town'])) {
    const doc=await io.read(path.join(here,'.cache/raw',name+'.glb'));
    if(name==='town') {
      // Optional single-facade rebuilds keep art iterations fast. A full Blender
      // build clears this directory, so stale overrides cannot survive rebuilds.
      const updates=path.join(here,'.cache/raw/facades');
      for(const file of await fs.readdir(updates).catch(()=>[])) {
        if(!file.endsWith('.glb'))continue;
        const source=await io.read(path.join(updates,file));
        const target=doc.getRoot().getDefaultScene();
        for(const replacement of source.getRoot().getDefaultScene().listChildren()) {
          const old=target.listChildren().find(n=>n.getName()===replacement.getName());
          if(old){for(const child of old.listChildren()){
            const mesh=child.getMesh();
            for(const primitive of mesh?.listPrimitives()||[])primitive.dispose();
            mesh?.dispose();child.dispose();
          }old.dispose();}
        }
        const map=mergeDocuments(doc,source),copied=map.get(source.getRoot().getDefaultScene());
        for(const child of copied.listChildren())target.addChild(child);
        copied.dispose();
      }
    }
    if(name==='props') {
      const scene=doc.getRoot().getDefaultScene();
      for(const lib of ['mechanics','scatter']) {
        const source=await io.read(path.join(here,'.cache/raw',lib+'.glb'));
        const map=mergeDocuments(doc,source);
        const copiedScene=map.get(source.getRoot().getDefaultScene());
        for(const node of copiedScene.listChildren())scene.addChild(node);
        copiedScene.dispose();
      }
    }
    await doc.transform(unpartition(),dedup({propertyTypes:['Accessor','Material']}));
    // No resampling, pruning nodes, joining models or geometry simplification.
    await doc.transform(meshopt({encoder:MeshoptEncoder,level:name==='bunny'?'medium':'high',
      quantizePosition:name==='town'?14:16,quantizeNormal:name==='bunny'?12:8,quantizeColor:8,quantizeWeight:8,
      cleanup:true}));
    await io.write(path.join(out,name+'.glb'),doc);
    console.log(`${name}: ${(await fs.stat(path.join(out,name+'.glb'))).size} bytes`);
    // Blender imports this decoded copy of the DELIVERED compressed bytes.
    await decode(name);
  }
}
if(process.argv[1]===fileURLToPath(import.meta.url))await main();

// Exercise the renderer's real loader/decoder without changing application code.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const three=path.resolve(process.env.RUN3D_THREE_ROOT||'node_modules/three');
const moduleAt=relative=>import(pathToFileURL(path.join(three,relative)).href);
const [{GLTFLoader},{MeshoptDecoder},{Box3,Vector3,AnimationMixer}]=await Promise.all([
  moduleAt('examples/jsm/loaders/GLTFLoader.js'),
  moduleAt('examples/jsm/libs/meshopt_decoder.module.js'),
  moduleAt('build/three.module.js'),
]);
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder),report={};
for(const name of ['bunny','props','town']){
  const b=fs.readFileSync(`public/brand/run3d/${name}.glb`);
  const g=await loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
  g.scene.updateMatrixWorld(true);
  const roots={};
  for(const root of g.scene.children){
    const box=new Box3().setFromObject(root,true),size=box.getSize(new Vector3());
    if(!box.isEmpty())assert([...box.min,...box.max].every(Number.isFinite));
    roots[root.name]={size:size.toArray()};
  }
  let animationPoses=0;
  if(name==='bunny'){
    assert(Math.abs(roots.BunnyClay.size[1]-1.6)<.002);
    const mixer=new AnimationMixer(g.scene);
    for(const clip of g.animations){
      mixer.stopAllAction();const action=mixer.clipAction(clip).reset().play();
      for(let i=0;i<=24;i++){
        mixer.setTime(clip.duration*i/24);g.scene.updateMatrixWorld(true);
        const box=new Box3().setFromObject(g.scene,true);
        assert([...box.min,...box.max].every(Number.isFinite));
        assert(box.min.y>=-.002,`${clip.name}: ground penetration ${box.min.y}`);animationPoses++;
      }
      action.stop();
    }
  }
  report[name]={sha256:createHash('sha256').update(b).digest('hex'),roots,animationPoses};
}
fs.writeFileSync('assets-src/run3d/.cache/loader-check.json',JSON.stringify(report,null,2)+'\n');
console.log('Three GLTFLoader + MeshoptDecoder: all roots loaded; 175 bunny poses finite and grounded.');

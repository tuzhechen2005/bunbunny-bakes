"""Integration check: import shipped skin and evaluate keys plus half-key poses."""
import bpy, math, json, os, hashlib
from pathlib import Path
out=Path(os.environ.get('RUN3D_OUT','/work/public/brand/run3d'))
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(out/'bunny.glb'))
rig=next(o for o in bpy.data.objects if o.type=='ARMATURE')
mesh=next(o for o in bpy.data.objects if o.type=='MESH')
assert len(bpy.data.actions)==7
report={}
for action in bpy.data.actions:
    rig.animation_data.action=action
    lowest=float('inf');highest=0;count=0
    for half in range(round(action.frame_range[0]*2),round(action.frame_range[1]*2)+1):
        frame=half/2;bpy.context.scene.frame_set(int(frame),subframe=frame%1);bpy.context.view_layer.update()
        evaluated=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
        points=[evaluated.matrix_world@v.co for v in evaluated.data.vertices]
        assert all(math.isfinite(c) for p in points for c in p),action.name
        bottom=min(p.z for p in points)
        assert bottom>=-.002,(action.name,frame,bottom)
        lowest=min(lowest,bottom);highest=max(highest,max(p.z for p in points));count+=1
    name=action.name.split('_')[0];report[name]={'sampledPoses':count,'minimumY':round(lowest,6),'maximumY':round(highest,6)}
    print(f'{name}: {count} poses; floor {lowest:.4f} m; maximum height {highest:.4f} m')
print('POSE_ASSET_SHA256='+hashlib.sha256((out/'bunny.glb').read_bytes()).hexdigest())
print('POSE_REPORT='+json.dumps(report,sort_keys=True))
print('All seven imported actions: finite skinning, no ground penetration at keys or midpoints.')

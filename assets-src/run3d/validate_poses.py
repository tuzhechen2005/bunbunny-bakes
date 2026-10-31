"""Blender-side integration check: import shipped skin/animations and evaluate every key."""
import bpy
import math
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath='/work/public/brand/run3d/bunny.glb')
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
mesh = next(o for o in bpy.data.objects if o.type == 'MESH')
assert len(bpy.data.actions) == 7
for action in bpy.data.actions:
    rig.animation_data.action = action
    lowest = float('inf')
    highest = 0
    for frame in range(round(action.frame_range[0]), round(action.frame_range[1]) + 1):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        evaluated = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
        points = [evaluated.matrix_world @ v.co for v in evaluated.data.vertices]
        assert all(math.isfinite(c) for p in points for c in p), action.name
        bottom = min(p.z for p in points)
        assert bottom >= -.002, (action.name, frame, bottom)
        lowest = min(lowest, bottom)
        highest = max(highest, max(p.z for p in points))
    print(f'{action.name}: floor {lowest:.4f} m; maximum height {highest:.4f} m')
print('All seven imported actions: finite skinning, no sampled ground penetration.')

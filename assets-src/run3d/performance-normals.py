"""Restore geometric clay normals after topology reduction.
Thin paving and canvas faces stay flat; facade bevels retain smooth shading.
Organic props receive averaged normals on welded topology. Never transfer across
nearby disconnected surfaces (e.g. a cobble top and its buried side).
"""
from pathlib import Path
import bpy, bmesh, math
HERE=Path(__file__).resolve().parent
for library in ('town','street','props'):
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    path=HERE/'.cache/performance'/(library+'.glb')
    bpy.ops.import_scene.gltf(filepath=str(path))
    for target in list(bpy.context.scene.objects):
        if target.type!='MESH':continue
        bpy.ops.object.select_all(action='DESELECT');target.select_set(True)
        bpy.context.view_layer.objects.active=target
        if library=='props' and target.name!='buntingMesh':
            bm=bmesh.new();bm.from_mesh(target.data)
            bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=0.00001)
            bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
            bm.normal_update()
            tree=target.name in ('treeMesh','tree_round2Mesh','tree_tallMesh')
            for edge in bm.edges:
                # No angular cutoff on leaf blobs. Preserve the pot rim and
                # lower trunk creases below the lowest canopy (0.9 m).
                lower=all((target.matrix_world @ v.co).z < .9 for v in edge.verts)
                edge.smooth=not (tree and lower and edge.is_manifold and
                                 edge.calc_face_angle() > math.radians(50))
            bm.to_mesh(target.data);bm.free()
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
        for polygon in target.data.polygons:
            polygon.use_smooth=target.name not in ('roadMesh','sidewalkMesh','buntingMesh')
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',export_yup=True,export_texcoords=False,export_normals=True,export_animations=False,export_extras=True)

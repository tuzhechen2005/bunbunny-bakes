"""R18: rebuild architecture at low segment counts, then budget each library mesh.
Blender 4.3.2. Collapse preserves material boundaries, colour interpolation and
skin groups; planar dissolve is limited to truly coplanar static surfaces.
"""
import sys, math
from pathlib import Path
import bpy, bmesh
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import nature as n
f=n.f;r=n.r
OUT=HERE/'.cache/performance'
OUT.mkdir(parents=True,exist_ok=True)
LIMITS={**{k:3200 for k in ('tree','tree_round2','tree_tall')},'lamp':800,'bunting':600,'planter':1500,'bicycle':1500,'crate_stack':1500,'menu_board':1500,'bench':1500,'van':2800,'truck':2800,'signal':600,**{k:1700 for k in ('flour','ramp','bread','bag','coffee','pothole','breadwheel','shoes','shield')},'road':1300,'sidewalk':700,'BunnyClay':7000,'sidewalkPlant':350}
def count(o):return sum(len(p.vertices)-2 for p in o.data.polygons)
def budget(o,name):
    limit=LIMITS.get(name,7000 if name in f.FACADES else 2500)
    before=count(o)
    if name!='BunnyClay':
        mod=o.modifiers.new('Dissolve coplanar interiors','DECIMATE');mod.decimate_type='DISSOLVE';mod.angle_limit=.001;mod.delimit={'MATERIAL','NORMAL'}
        r.apply(o,mod)
    if count(o)>limit:
        mod=o.modifiers.new('Silhouette budget','DECIMATE');mod.ratio=(limit-40)/count(o);mod.use_collapse_triangulate=True
        r.apply(o,mod)
    assert count(o)<=limit,(name,count(o),limit)
    print('R18',name,before,count(o),flush=True)
    return o

# Architecture is regenerated, reducing tessellation before geometry is joined.
ball=r.ball;tube=r.tube;disc=r.disc;profile=r.profile;lathe=r.lathe
r.ball=lambda name,p,s,k,seg=16,rings=10,sub=0:ball(name,p,s,k,min(seg,10),min(rings,6),0)
r.tube=lambda name,pts,rad,k,res=2,sides=3:tube(name,pts,rad,k,min(res,2),0)
r.disc=lambda name,p,rad,d,k,axis='z',vertices=24:disc(name,p,rad,d,k,axis,min(vertices,12))
r.profile=lambda name,p,s,k,outline,sub=2:profile(name,p,s,k,outline,min(sub,1))
r.lathe=lambda name,p,outline,k,segments=32:lathe(name,p,outline,k,min(segments,12))
def box(name,p,s,k,b=.04,segments=2,sub=0):
    return f.original_box(name,p,s,k,0 if r.ROOT and r.ROOT.name in ('road','sidewalk') else b,1,0)
r.box=f.box=box
def planter(*args,**kwargs):
    if not r.ROOT or r.ROOT.name!='sidewalk':return n.planter(*args,**kwargs)
    previous=list(r.PARTS);r.PARTS=[]
    n.planter(*args,**kwargs)
    plant=budget(f.original_join('Sidewalk planting'),'sidewalkPlant')
    r.PARTS=previous+[plant]
r.planter=planter;r.awning=n.awning
# Minuscule stone height variation cannot justify four rings per road cobble.
def cobble(x,z,k,width=.478):
    h=.008+.004*(.5+.5*math.sin(x*12.7+z*9.3))
    # Only the visible rounded top is needed; the road bed closes the bottom.
    a=width/2;b=.239;c=.045
    outline=[(-a+c,-b),(a-c,-b),(a,-b+c),(a,b-c),(a-c,b),(-a+c,b),(-a,b-c),(-a,-b+c)]
    return n.mesh('Low clay cobble',[(x+xx,h,z+zz) for xx,zz in outline],[tuple(reversed(range(8)))],k)
r.cobble=cobble
join=f.joined
def joined(name):
    if r.ROOT.name=='sidewalk':
        # Keep paving as independent flat boxes. Never collapse a thin slab's
        # top into its bottom just to pay for unseen planting detail.
        o=f.original_join(name);f.ao(o)
        assert count(o)<=700
        return o
    return budget(join(name),r.ROOT.name)
r.joined=joined
r.OUT=OUT
if '--street-only' in sys.argv:
    export=r.export
    r.export=lambda _:export('street')
if not any(flag in sys.argv for flag in ('--props-only','--bunny-only')):r.town([] if '--street-only' in sys.argv else f.FACADES)
if '--street-only' in sys.argv:
    sys.exit(0)
# The already approved organic forms and rig are reduced directly. Rebuilding
# these from older authoring code would change R17 silhouettes and animation.
for library in (('bunny',) if '--bunny-only' in sys.argv else ('props',) if '--props-only' in sys.argv else ('props','bunny')):
    r.clear();bpy.ops.import_scene.gltf(filepath=str(HERE/'.cache/before-decoded'/(library+'.glb')))
    if library=='props':
        r.ROOT=bpy.data.objects['puddle'];r.PARTS=[]
        for child in list(r.ROOT.children):bpy.data.objects.remove(child,do_unlink=True)
        # Structured radial sampling retains the three ripple ridges; collapsing
        # shiny water creates visible irregular reflection facets.
        n.puddle(segments=32,rings=32)
        water=f.original_join('puddleMesh');assert count(water)<=2500
    for o in list(bpy.context.scene.objects):
        if o.type=='MESH' and o.name!='puddleMesh':
            if library=='props':
                # glTF splits vertices for corner attributes. Restore shared topology
                # before collapse, then discard normals from the old tessellation.
                bm=bmesh.new();bm.from_mesh(o.data)
                bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=0.00001)
                bm.to_mesh(o.data);bm.free()
                bpy.context.view_layer.objects.active=o
                bpy.ops.mesh.customdata_custom_splitnormals_clear()
                for face in o.data.polygons:face.use_smooth=o.name!='buntingMesh'
            budget(o,'BunnyClay' if library=='bunny' else o.parent.name)
    bpy.ops.export_scene.gltf(filepath=str(OUT/(library+'.glb')),export_format='GLB',export_yup=True,export_texcoords=False,export_animations=False,export_extras=True)

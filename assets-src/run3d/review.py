"""Render actual decoded delivery geometry; never render a separate proxy model."""
import sys, os, math, json, hashlib
from pathlib import Path
import bpy
HERE=Path(__file__).resolve().parent
os.environ['RUN3D_OUT']=os.environ.get('RUN3D_REVIEW_SOURCE',str(HERE/'.cache/decoded'))
sys.path.insert(0,str(HERE))
import render as r


def save(name,width,height):
    scene=bpy.context.scene
    scene.render.resolution_x=width;scene.render.resolution_y=height
    scene.cycles.samples=96
    destination=Path(os.environ.get('RUN3D_REVIEW_DIR',str(HERE)))
    destination.mkdir(parents=True,exist_ok=True)
    scene.render.filepath=str(destination/name)
    bpy.ops.render.render(write_still=True)


def street():
    r.clear();town=r.import_library('town');props=r.import_library('props')
    # Match runThree.ts: road scale .78, facade offset 3.12+4.2, 55° vertical
    # field of view, camera (0,4.6,-7.2), target (0,1.1,7), normal speed.
    for z in range(-6,43,6):
        road=r.instance(town['road'],(0,0,z));road.scale.x=.78
        for side in (-1,1):r.instance(town['sidewalk'],(side*4.12,0,z),math.pi if side<0 else 0)
    for side,names in [(-1,['patisserie','bakery','tea_house','house_rose','flower_shop','patisserie','house_sage']),
                       (1,['cheese_shop','corner_house','cafe','book_shop','house_sage','tea_house','house_rose'])]:
        for i,name in enumerate(names):r.instance(town[name],(side*7.32,.18,3+6*i),-side*math.pi/2)
    root=r.load_bunny((0,.024,0))
    rig=next(o for o in root.children if o.type=='ARMATURE')
    rig.animation_data.action=next(a for a in bpy.data.actions if a.name.startswith('run_'))
    bpy.context.scene.frame_set(5)
    for name,p,yaw in [
        ('cart',(-2.1,.024,6),0),('van',(2.1,.024,15),0),('ramp',(2.1,.024,11),0),
        ('bicycle',(3.9,.18,3),.25),('menu_board',(-4.1,.18,2),.35),
        ('puddle',(-1.3,.024,1.8),0),('planter',(4.2,.18,7),0),('crate_stack',(-4.2,.18,9),.1),
        ('bench',(4.2,.18,19),math.pi/2),('bunting',(0,5.0,9),0),('bunting',(0,5.0,24),0)]:r.instance(props[name],p,yaw)
    for z,name in zip((0,12,24),('tree','tree_round2','tree_tall')):
        r.instance(props['lamp'],(-3.85,.18,z+4));r.instance(props[name],(4.1,.18,z+3))
    r.instance(props['tree_round2'],(-4.15,.18,6))
    for z in (3,4.5,6):r.instance(props['bread'],(0,.55,z))
    r.box('Warm ground',(0,-.10,12),(200,.06,200),'cream',.01)
    r.light_scene();r.camera((0,4.6,-7.2),(0,1.1,7))
    cam=bpy.context.scene.camera.data;cam.sensor_fit='VERTICAL';cam.sensor_height=32
    cam.lens=32/(2*math.tan(math.radians(55)/2))
    save('preview.png',720,900)


def closeup():
    r.clear();root=r.load_bunny();rig=next(o for o in root.children if o.type=='ARMATURE')
    rig.animation_data.action=None
    for b in rig.pose.bones:b.rotation_mode='XYZ';b.rotation_euler=(0,0,0);b.location=(0,0,0);b.scale=(1,1,1)
    r.box('Studio floor',(0,-.065,0),(200,.10,200),'cream',.01)
    r.light_scene(True);r.camera((1.45,1.50,4.8),(0,.81,0),80)
    save('bunny-closeup.png',760,900)


def props_sheet():
    r.clear();lib=r.import_library('props')
    names=['cart','flour','awning','puddle','ramp','van','truck','bread','bag','coffee','lamp','tree','bench','pothole','breadwheel','shoes','shield','signal','planter','bicycle','crate_stack','menu_board','bunting','tree_round2','tree_tall']
    # Two broad vehicle bays, then small props. Uniform per-asset scale is listed
    # in the manifest so the sheet remains useful for visual review.
    for i,n in enumerate(names):
        x=(i%5-2)*3.5;z=(i//5-2)*4.0
        yaw=-1.0 if n in ('bicycle','breadwheel') else (1.0 if n=='ramp' else .18)
        o=r.instance(lib[n],(x,.04 if n!='bunting' else 1,z),yaw)
        if n in ('van','truck','bunting'):o.scale=(.48,.48,.48)
    r.box('Review floor',(0,-.065,0),(200,.10,200),'cream',.01)
    r.light_scene(True);r.camera((14,21,29),(0,.45,0),52)
    save('props-review.png',1400,1150)


def facades_sheet():
    r.clear();lib=r.import_library('town')
    names=['bakery','cafe','flower_shop','book_shop','house_rose','house_sage','patisserie','cheese_shop','tea_house','corner_house']
    for i,n in enumerate(names):r.instance(lib[n],((i%5-2)*7.1,0,-(i//5)*18),0)
    r.box('Review floor',(0,-.065,0),(200,.10,200),'cream',.01)
    r.light_scene();r.camera((13,45,44),(0,3,-8),58)
    save('facades-review.png',1600,1000)



def trees_closeup():
    r.clear();lib=r.import_library('props')
    for i,name in enumerate(('tree','tree_round2','tree_tall')):
        r.instance(lib[name],((i-1)*2.1,0,0),.15 if i==1 else 0)
    r.box('Studio floor',(0,-.065,0),(200,.10,200),'cream',.01)
    r.light_scene(True);r.camera((3.6,3.0,11.0),(0,1.32,0),62)
    save('trees-closeup.png',1400,900)


def puddle_closeup():
    r.clear();props=r.import_library('props');town=r.import_library('town')
    r.instance(town['road'],(0,-.012,0));r.instance(props['puddle'])
    r.light_scene(True)
    # A reflected softbox reveals the delivered water normals and low roughness.
    from mathutils import Vector
    bpy.ops.object.light_add(type='AREA',location=r.xyz((-1.4,3.0,-2.65)))
    light=bpy.context.object;light.data.energy=18;light.data.shape='RECTANGLE';light.data.size=2.6;light.data.size_y=.65
    light.rotation_euler=(-light.location).to_track_quat('-Z','Y').to_euler()
    r.camera((1.4,2.35,2.65),(0,.006,0),62)
    save('puddle-closeup.png',1100,850)


def rounded_props_closeup():
    r.clear();lib=r.import_library('props')
    for name,p in [('planter',(-1.1,0,0)),('bread',(0,0,.4)),('bag',(.65,0,0)),('crate_stack',(1.5,0,-.4)),('puddle',(-.15,0,1.4))]:
        r.instance(lib[name],p)
    r.box('Studio floor',(0,-.065,0),(200,.10,200),'cream',.01)
    r.light_scene(True);r.camera((3.5,3.7,7.0),(0,.45,.45),60)
    save('props-closeup.png',1400,1000)


def planting_closeup():
    r.clear();props=r.import_library('props')
    r.instance(props['awning'],(-1.25,0,0));r.instance(props['planter'],(1.0,0,.12))
    r.box('Studio floor',(0,-.065,0),(200,.10,200),'cream',.01)
    r.light_scene(True);r.camera((2.0,2.4,6.6),(0,.65,0),55)
    save('planting-closeup.png',1200,800)

if __name__=='__main__':
    selection=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else ['street','trees','puddle','planting','props','facades']
    for name in selection:{'street':street,'closeup':closeup,'props':props_sheet,'facades':facades_sheet,'trees':trees_closeup,'puddle':puddle_closeup,'planting':planting_closeup,'rounded':rounded_props_closeup}[name]()
    public=HERE.parents[1]/'public/brand/run3d'
    (HERE/'.cache/preview-provenance.json').write_text(json.dumps({
        'sourceSha256':{n:hashlib.sha256((public/(n+'.glb')).read_bytes()).hexdigest() for n in ('bunny','props','town')},
        'importedDecodedSha256':{n:hashlib.sha256((Path(os.environ['RUN3D_OUT'])/(n+'.glb')).read_bytes()).hexdigest() for n in ('bunny','props','town')},
        'geometrySource':'Blender imports meshopt-decoded packed public GLBs; no normal regeneration in review',
        'gameCamera':{'position':[0,4.6,-7.2],'target':[0,1.1,7],'verticalFovDegrees':55,'roadScaleX':.78},
        'natureCloseupOrder':['tree','tree_round2','tree_tall'],
        'puddleCloseup':'Decoded puddle on decoded road stones; road offset -0.012 m; reflected 18 W rectangular softbox',
        'lighting':'Cycles 96 samples, seed 12, AgX, warm area lights',
        'propsReviewOrder':['cart','flour','awning','puddle','ramp','van','truck','bread','bag','coffee','lamp','tree','bench','pothole','breadwheel','shoes','shield','signal','planter','bicycle','crate_stack','menu_board','bunting','tree_round2','tree_tall'],
        'facadeReviewOrder':['bakery','cafe','flower_shop','book_shop','house_rose','house_sage','patisserie','cheese_shop','tea_house','corner_house']
    },indent=2)+'\n')

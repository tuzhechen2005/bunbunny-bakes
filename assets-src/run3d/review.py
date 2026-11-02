"""Render actual decoded delivery geometry; never render a separate proxy model."""
import sys, os, math, json, hashlib
from pathlib import Path
import bpy
HERE=Path(__file__).resolve().parent
os.environ['RUN3D_OUT']=str(HERE/'.cache/decoded')
sys.path.insert(0,str(HERE))
import render as r


def save(name,width,height):
    scene=bpy.context.scene
    scene.render.resolution_x=width;scene.render.resolution_y=height
    scene.cycles.samples=96
    scene.render.filepath=str(HERE/name)
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
        ('planter',(4.2,.18,7),0),('crate_stack',(-4.2,.18,9),.1),
        ('bench',(4.2,.18,19),math.pi/2),('bunting',(0,5.0,9),0),('bunting',(0,5.0,24),0)]:r.instance(props[name],p,yaw)
    for z in (4,16,28):
        r.instance(props['lamp'],(-3.85,.18,z));r.instance(props['tree'],(4.4,.18,z+6))
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
    names=['cart','flour','awning','puddle','ramp','van','truck','bread','bag','coffee','lamp','tree','bench','pothole','breadwheel','shoes','shield','signal','planter','bicycle','crate_stack','menu_board','bunting']
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


if __name__=='__main__':
    selection=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else ['street','closeup','props','facades']
    for name in selection:{'street':street,'closeup':closeup,'props':props_sheet,'facades':facades_sheet}[name]()
    public=HERE.parents[1]/'public/brand/run3d'
    (HERE/'.cache/preview-provenance.json').write_text(json.dumps({
        'sourceSha256':{n:hashlib.sha256((public/(n+'.glb')).read_bytes()).hexdigest() for n in ('bunny','props','town')},
        'gameCamera':{'position':[0,4.6,-7.2],'target':[0,1.1,7],'verticalFovDegrees':55,'roadScaleX':.78},
        'lighting':'Cycles 96 samples, seed 12, AgX, warm area lights',
        'propsReviewOrder':['cart','flour','awning','puddle','ramp','van','truck','bread','bag','coffee','lamp','tree','bench','pothole','breadwheel','shoes','shield','signal','planter','bicycle','crate_stack','menu_board','bunting'],
        'facadeReviewOrder':['bakery','cafe','flower_shop','book_shop','house_rose','house_sage','patisserie','cheese_shop','tea_house','corner_house']
    },indent=2)+'\n')

"""Original procedural clay assets. Author in game metres, convert to Blender Z-up."""
import bpy, math, json
from pathlib import Path
from mathutils import Vector
OUT = Path('/work/public/brand/run3d')
OUT.mkdir(parents=True, exist_ok=True)
P = {'fur':'FFF9ED','pink':'E8B3A0','cream':'F8EEDB','bread':'E5AA56','score':'FADE9D','kraft':'BD8A53','wood':'80573E','dark':'46392F','sage':'9CA981','stone':'C1B6A6','grout':'9D9388','cobble':'A89E92','rose':'CF9580','glass':'AFC8C3','water':'91B7BD','roof':'BD8062','plaster':'E6D5B9'}
def xyz(v): return (v[0],-v[2],v[1])
def mat(k):
    if k in bpy.data.materials: return bpy.data.materials[k]
    m=bpy.data.materials.new(k); m.use_nodes=True
    rgb=[int(P[k][i:i+2],16)/255 for i in (0,2,4)]
    rgb=[v/12.92 if v<.04045 else ((v+.055)/1.055)**2.4 for v in rgb]
    p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*rgb,1)
    p.inputs['Roughness'].default_value=.16 if k=='water' else .82
    m.diffuse_color=(*rgb,1); return m
ROOT=None; PARTS=[]; BONE=None; DETAIL=2

def finish(o,k):
    o.data.materials.append(mat(k)); o.parent=ROOT
    if BONE:
        g=o.vertex_groups.new(name=BONE); g.add(list(range(len(o.data.vertices))),1,'REPLACE')
    PARTS.append(o); return o

def ball(n,p,s,k,seg=12,rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg,ring_count=rings,location=xyz(p))
    o=bpy.context.object; o.name=n; o.scale=(s[0],s[2],s[1]); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    for f in o.data.polygons:f.use_smooth=True
    return finish(o,k)

def box(n,p,s,k,b=.035):
    bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(p)); o=bpy.context.object; o.name=n; o.scale=(s[0],s[2],s[1]); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if b and DETAIL:
        mod=o.modifiers.new('Soft clay edges','BEVEL'); mod.width=b; mod.segments=DETAIL
        bpy.ops.object.modifier_apply(modifier=mod.name)
        mod=o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL'); bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(o,k)

def group(n):
    global ROOT,PARTS
    ROOT=bpy.data.objects.new(n,None); bpy.context.collection.objects.link(ROOT); PARTS=[]
    ROOT['units']='metres'; ROOT['forward']='+Z'; return ROOT

def joined(n):
    global PARTS
    bpy.ops.object.select_all(action='DESELECT')
    for o in PARTS:o.select_set(True)
    bpy.context.view_layer.objects.active=PARTS[0]; bpy.ops.object.join(); o=bpy.context.object; o.name=n
    bpy.context.scene.cursor.location=(0,0,0); bpy.ops.object.origin_set(type='ORIGIN_CURSOR'); PARTS=[o]; return o

def clear():
    global ROOT,PARTS,BONE
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False); ROOT=None; PARTS=[]; BONE=None

def export(name,anim=False):
    bpy.ops.export_scene.gltf(filepath=str(OUT/(name+'.glb')),export_format='GLB',export_yup=True,export_texcoords=False,export_animations=anim,export_animation_mode='ACTIONS',export_force_sampling=True,export_optimize_animation_size=False,export_extras=True,export_cameras=False,export_lights=False)

def loaf(p=(0,.2,0),s=1):
    x,y,z=p; ball('Golden loaf',p,(.225*s,.13*s,.13*s),'bread')
    for dx in (-.10,0,.10):box('Flour score',(x+dx*s,y+.115*s,z),(.026*s,.014*s,.14*s),'score',.006*s)

def bag(p=(0,0,0),s=1):
    x,y,z=p;box('Kraft bag',(x,y+.26*s,z),(.39*s,.52*s,.22*s),'kraft')
    box('Folded rim',(x,y+.5*s,z),(.42*s,.05*s,.24*s),'wood',.015)
    ball('Bakery seal',(x,y+.28*s,z-.115*s),(.075*s,.075*s,.008*s),'rose')
    for dx in (-.10,.10):ball('Baguette',(x+dx*s,y+.57*s,z),(.065*s,.23*s,.065*s),'bread')

def bunny():
    global BONE,ROOT
    clear(); group('bunny'); root=ROOT
    BONE='body';ball('Pear body',(0,.60,0),(.30,.43,.23),'fur',16,10)
    ball('Cotton tail',(0,.38,-.25),(.13,.13,.12),'fur')
    BONE='head';ball('Round head',(0,1.02,.015),(.285,.265,.235),'fur',16,10)
    for side in (-1,1):
        ball('Cheek',(side*.12,.95,.205),(.12,.10,.065),'fur')
        ball('Eye',(side*.12,1.065,.225),(.026,.035,.014),'dark',8,6)
    ball('Nose',(0,.99,.27),(.035,.023,.025),'pink',8,6)
    for side,label in ((-1,'L'),(1,'R')):
        BONE='ear'+label; ball('Long ear',(side*.13,1.35,0),(.085,.25,.075),'fur')
        ball('Inner ear',(side*.13,1.36,.064),(.043,.18,.014),'pink')
        BONE='leg'+label;ball('Haunch',(side*.19,.28,0),(.15,.22,.16),'fur')
        ball('Foot',(side*.19,.10,.085),(.13,.10,.235),'fur')
        BONE='arm'+label;ball('Arm',(side*.30,.60,.02),(.09,.24,.10),'fur')
    BONE='body';bag((0,.43,-.31),.86)
    for x in (-.19,.19):box('Backpack strap',(x,.75,-.23),(.045,.50,.045),'wood',.015)
    mesh=joined('BunnyClay');BONE=None
    bpy.ops.object.armature_add(); rig=bpy.context.object;rig.name='BunnyRig';rig.parent=root
    bpy.ops.object.mode_set(mode='EDIT');rig.data.edit_bones.remove(rig.data.edit_bones[0])
    points={'body':(0,.46,0),'head':(0,.87,0),'earL':(-.13,1.15,0),'earR':(.13,1.15,0),'legL':(-.19,.40,0),'legR':(.19,.40,0),'armL':(-.28,.78,0),'armR':(.28,.78,0)}
    for name,p in points.items():
        b=rig.data.edit_bones.new(name);b.head=xyz(p);b.tail=xyz((p[0],p[1]+.15,p[2]))
        if name!='body':b.parent=rig.data.edit_bones['head' if name.startswith('ear') else 'body']
    bpy.ops.object.mode_set(mode='OBJECT');mesh.parent=None;rig.parent=None;bpy.data.objects.remove(root,do_unlink=True);mod=mesh.modifiers.new('One armature','ARMATURE');mod.object=rig
    rig.animation_data_create();bpy.context.scene.render.fps=24
    for name,count in [('run',25),('jump',25),('slide',25),('leanL',13),('leanR',13),('crash',21),('idle',49)]:
        action=bpy.data.actions.new(name);action.use_fake_user=True;rig.animation_data.action=action
        for f in range(count):
            t=f/(count-1);wave=math.sin(t*math.tau)
            for bone in rig.pose.bones:
                bone.rotation_mode='XYZ';bone.rotation_euler=(0,0,0);bone.location=(0,0,0)
            b=rig.pose.bones['body']
            if name=='run':
                b.location.y=.035*(1-math.cos(2*t*math.tau));b.rotation_euler.x=-.10
                for s,l in ((1,'L'),(-1,'R')):
                    rig.pose.bones['leg'+l].rotation_euler.x=s*.7*wave
                    rig.pose.bones['arm'+l].rotation_euler.x=-s*.6*wave
                    rig.pose.bones['ear'+l].rotation_euler.x=.13*math.sin(t*math.tau+.5)
            elif name=='jump':
                b.rotation_euler.x=-.18*math.sin(math.pi*t)
                for l in ('L','R'):rig.pose.bones['leg'+l].rotation_euler.x=.85*math.sin(math.pi*t)
            elif name=='slide':
                b.location.y=-.23;b.rotation_euler.x=1.05+.025*wave
                for l in ('L','R'):rig.pose.bones['leg'+l].rotation_euler.x=-1.25
            elif name.startswith('lean'):
                b.rotation_euler.z=(.32 if name=='leanL' else -.32)*math.sin(t*math.pi/2)
            elif name=='crash':b.rotation_euler.x=-1.25*t;b.location.y=-.20*t
            else:b.location.y=.012*(1-math.cos(t*math.tau))
            # Keep every pose above the floor; world jumping remains engine-owned.
            bpy.context.view_layer.update()
            evaluated=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
            floor=min((evaluated.matrix_world@v.co).z for v in evaluated.data.vertices)
            b.location.y+=max(0,-floor)
            for bone in rig.pose.bones:
                bone.keyframe_insert('rotation_euler',frame=f+1);bone.keyframe_insert('location',frame=f+1)
        for fc in action.fcurves:
            for key in fc.keyframe_points:key.interpolation='LINEAR'
    rig.animation_data.action=None
    for b in rig.pose.bones:b.rotation_euler=(0,0,0);b.location=(0,0,0)
    bpy.context.scene.frame_set(1);export('bunny',True)


def awning(width=1.8,height=1.1,depth=.8):
    for x in (-width/2+.045,width/2-.045):box('Post',(x,(height+.25)/2,0),(.07,height+.25,.07),'wood')
    for i in range(10):
        x=-width/2+(i+.5)*width/10
        box('Canvas stripe',(x,height+.19,0),(width/10,.12,depth),'cream' if i%2 else 'rose',.015)
        box('Scalloped valance',(x,height+.08,-depth/2+.03),(width/10,.16,.06),'cream' if i%2 else 'rose',.025)

def vehicle(color):
    box('Body',(0,.65,0),(1.8,1.05,5.84),color,.10)
    box('Flat walkable roof',(0,1.24,0),(1.9,.12,6),color,.035)
    box('Windshield',(0,.96,2.925),(1.53,.4,.02),'glass',.025)
    for x in (-.66,.66):
        box('Headlight',(x,.48,2.94),(.30,.18,.04),'cream')
        box('Rear light',(x,.44,-2.94),(.15,.18,.04),'rose')
        for z in (-2,2):ball('Wheel',(x/abs(x)*.82,.25,z),(.13,.25,.25),'dark')
    box('Bumper',(0,.24,2.95),(1.65,.12,.10),'stone')
    for x in (-.907,.907):
        box('Cab window',(x,.95,2.20),(.02,.35,.9),'glass',.02)
        box('Delivery panel',(x,.79,-.5),(.02,.48,2.5),'cream',.02)
        for z in (-1.1,-.5,.1):ball('Bread emblem',(x*1.015,.8,z),(.022,.14,.23),'bread')

def props():
    global DETAIL
    DETAIL=1
    clear()
    for n in ['cart','flour','awning','puddle','ramp','van','truck','bread','bag','coffee','lamp','tree','bench']:
        group(n)
        if n=='cart':
            box('Cart box',(0,.58,0),(1.8,.52,.85),'wood');box('Counter',(0,.88,0),(1.8,.12,.95),'kraft')
            for x in (-.7,.7):
                ball('Wheel',(x,.20,0),(.14,.2,.2),'dark')
                box('Canopy support',(x,1.05,.28),(.055,.65,.055),'wood')
            for i in range(8):box('Canopy stripe',(-.7875+i*.225,1.34,0),(.225,.12,1),'cream' if i%2 else 'sage')
            for x in (-.55,0,.55):loaf((x,1.02,0),.9)
        elif n=='flour':
            for x,y,z in [(-.25,.27,0),(.25,.27,0),(0,.69,0)]:
                ball('Flour sack',(x,y,z),(.28,.27 if y<.5 else .21,.25),'cream')
                box('Sack seam',(x,y+.14,z-.20),(.24,.035,.025),'kraft',.008)
        elif n=='awning':awning()
        elif n=='puddle':ball('Water',(0,.012,0),(.85,.012,.55),'water',24,6)
        elif n=='ramp':
            verts=[xyz(p) for p in [(-.85,0,-1),(.85,0,-1),(-.85,0,1),(.85,0,1),(-.85,1.3,1),(.85,1.3,1)]]
            me=bpy.data.meshes.new('Ramp');me.from_pydata(verts,[],[(0,1,5,4),(0,4,2),(1,3,5),(2,4,5,3),(0,2,3,1)]);me.update()
            o=bpy.data.objects.new('Ramp deck',me);bpy.context.collection.objects.link(o);finish(o,'wood')
        elif n in ('van','truck'):vehicle('sage' if n=='van' else 'rose')
        elif n=='bread':loaf((0,.13,0))
        elif n=='bag':bag()
        elif n=='coffee':
            ball('Cup',(0,.18,0),(.13,.18,.13),'cream');box('Sleeve',(0,.18,0),(.25,.13,.25),'kraft',.05)
            ball('Lid',(0,.35,0),(.145,.035,.145),'wood')
        elif n=='lamp':
            box('Foot',(0,.1,0),(.35,.2,.35),'wood');box('Pole',(0,1.4,0),(.09,2.8,.09),'wood')
            box('Lantern',(0,2.85,0),(.35,.45,.35),'cream');box('Cap',(0,3.10,0),(.45,.12,.45),'wood')
        elif n=='tree':
            box('Planter',(0,.23,0),(.8,.46,.8),'roof',.08);box('Trunk',(0,1,0),(.20,1.5,.20),'wood')
            for x,y,z,s in [(0,2,0,.70),(-.4,1.7,0,.5),(.4,1.8,.15,.52)]:ball('Clay foliage',(x,y,z),(s,s,s),'sage')
        else:
            for z in (-.18,0,.18):box('Seat slat',(0,.48,z),(1.6,.08,.14),'kraft')
            for y in (.72,.94):box('Back slat',(0,y,-.25),(1.6,.14,.07),'kraft')
            for x in (-.6,.6):box('Leg',(x,.25,0),(.09,.5,.45),'wood');box('Back support',(x,.7,-.25),(.07,.65,.07),'wood')
        joined(n+'Mesh')
    export('props')

def town():
    global DETAIL
    DETAIL=0
    clear()
    for index,n in enumerate(['bakery','cafe','flower_shop','book_shop','house_rose','house_sage']):
        group(n);color=['plaster','rose','cream','sage','rose','plaster'][index]
        box('Facade shell',(0,3.35,0),(6,6.7,4),color,.02)
        box('Roof cap',(0,6.85,0),(6,.30,4),'roof',.02)
        for y in (.18,3.2,6.5):box('Cornice',(0,y,2.025),(6,.16,.10),'cream',.02)
        for x in (-1.9,0,1.9):
            for y in (4.1,5.65):
                box('Window frame',(x,y,2.08),(1.10,1.10,.12),'cream')
                box('Window pane',(x,y,2.15),(.9,.90,.035),'glass',.015)
                box('Mullion',(x,y,2.18),(.05,.95,.03),'wood',.008)
                box('Window sill',(x,y-.56,2.17),(1.24,.10,.28),'cream')
        box('Door frame',(0,1.25,2.09),(1.22,2.5,.18),'wood')
        box('Door glass',(0,1.48,2.20),(.95,1.62,.035),'glass')
        ball('Door knob',(.37,.98,2.24),(.035,.035,.035),'bread',8,6)
        for x in (-1.95,1.95):
            box('Shop window frame',(x,1.65,2.09),(1.65,1.9,.18),'cream')
            box('Shop glass',(x,1.65,2.20),(1.42,1.65,.035),'glass')
        for i in range(16):box('Awning stripe',(-2.8125+i*.375,2.85,2.36),(.375,.16,.70),'cream' if i%2 else ('sage' if index%2 else 'rose'),.02)
        box('Sign board',(0,3.42,2.12),(2.7,.36,.15),'wood')
        # Sculpted signs avoid external fonts/textures and remain readable at game size.
        if index==0:loaf((0,3.42,2.25),1.05)
        elif index==1:
            box('Cup sign',(0,3.43,2.24),(.30,.24,.08),'cream')
            ball('Cup handle',(.20,3.44,2.24),(.10,.10,.04),'bread')
        elif index==2:
            for x in (-.3,0,.3):ball('Flower sign',(x,3.42,2.24),(.13,.13,.05),'pink')
        elif index==3:
            for i in range(5):box('Book sign',(-.3+i*.15,3.42,2.24),(.10,.24,.07),'cream' if i%2 else 'bread',.012)
        else:box('House plaque',(0,3.42,2.24),(.25,.23,.05),'bread')
        joined(n+'Mesh')
    group('sidewalk');box('Paving base',(0,.08,0),(2,.16,6),'stone',0)
    for z in (-2.5,-1.5,-.5,.5,1.5,2.5):
        for x in (-.5,.5):box('Paving slab',(x,.17,z),(.975,.02,.975),'cream',.008)
    joined('sidewalkMesh')
    group('road');box('Road bed',(0,-.035,0),(8,.07,6),'grout',0)
    for row in range(12):
        for col in range(16):
            box('Subtle cobble',(-3.75+col*.5,.006,-2.75+row*.5),(.475,.012,.475),'cobble' if (col+row)%3 else 'grout',.008)
    for x in (-8/6,8/6):
        for z in (-2,0,2):box('Lane dash',(x,.018,z),(.065,.012,.65),'cream',.005)
    joined('roadMesh');export('town')


def preview():
    clear()
    def load(file,n,p=(0,0,0),yaw=0):
        old=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(OUT/(file+'.glb')))
        new=set(bpy.data.objects)-old;roots=[o for o in new if not o.parent]
        if file=='bunny':
            keep=bpy.data.objects.new('bunnyPreview',None);bpy.context.collection.objects.link(keep)
            for o in roots:o.parent=keep
            keep.location=xyz(p);return keep
        keep=next(o for o in roots if o.name.split('.')[0]==n)
        for o in roots:
            if o!=keep:
                for c in list(o.children_recursive):bpy.data.objects.remove(c,do_unlink=True)
                bpy.data.objects.remove(o,do_unlink=True)
        keep.location=xyz(p);keep.rotation_mode='XYZ';keep.rotation_euler=(0,0,yaw);return keep
    for z in (0,6,12,18):
        load('town','road',(0,0,z))
        for x in (-5,5):load('town','sidewalk',(x,0,z))
    for side in (-1,1):
        for i,n in enumerate(['bakery','cafe','flower_shop'] if side<0 else ['book_shop','house_rose','house_sage']):load('town',n,(side*8,.16,3+i*6),-side*math.pi/2)
    load('bunny','bunny',(0,0,-.5));load('props','cart',(-2.5,0,4));load('props','van',(2.5,0,10));load('props','ramp',(2.5,0,6))
    for z in (2,9,16):
        load('props','lamp',(-4.5,.18,z));load('props','tree',(4.8,.18,z+1))
    for z in (2.5,4,5.5):load('props','bread',(0,.55,z))
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=128;scene.cycles.use_denoising=False;scene.cycles.seed=9
    scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.65,.72,.78,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.6
    bpy.ops.object.light_add(type='AREA',location=(-4,4,10));bpy.context.object.data.energy=1700;bpy.context.object.data.shape='DISK';bpy.context.object.data.size=7
    bpy.ops.object.light_add(type='SUN');bpy.context.object.rotation_euler=(.4,-.5,-.4);bpy.context.object.data.energy=2
    bpy.ops.object.camera_add(location=xyz((0,4.6,-7.5)));cam=bpy.context.object;cam.rotation_euler=(Vector(xyz((0,1.2,3)))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.lens=32;scene.camera=cam
    scene.render.resolution_x=480;scene.render.resolution_y=600;scene.render.resolution_percentage=100
    scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=.5
    scene.render.image_settings.file_format='PNG';scene.render.filepath=str(OUT/'preview.png');bpy.ops.render.render(write_still=True)

if __name__ == '__main__':
    import sys
    if '--preview-only' not in sys.argv:
        bunny();props();town()
    preview()

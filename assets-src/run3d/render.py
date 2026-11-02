"""R12: original sculpted clay-toy assets, authored in game metres (+Y up/+Z forward).
No image textures, external meshes, fonts, or runtime changes. Blender 4.3.2.
"""
import bpy, math, json, sys, os
from pathlib import Path
from mathutils import Vector
OUT = Path(os.environ.get('RUN3D_OUT','/work/public/brand/run3d'))
OUT.mkdir(parents=True, exist_ok=True)
P = {'fur':'FFF4DF','pink':'EAA38E','cream':'F6EEDC','bread':'D99A4E',
     'score':'F6DBA2','crust':'C39461','kraft':'BC8B57','wood':'745742',
     'dark':'493025','sage':'A6B39A','leaf':'879E74','stone':'CABAA0',
     'grout':'B5A68F','cobble':'D0BEA3','rose':'C8866C','glass':'839F9A',
     'water':'91B7BD','roof':'BC775A','plaster':'EDDFC5','soil':'81654C','sandstone':'D9C1A1','warmstone':'C9AD93'}
ROOT=None; PARTS=[]; BONE=None

def xyz(v): return (v[0],-v[2],v[1])
def linear(v): return v/12.92 if v<.04045 else ((v+.055)/1.055)**2.4

def mat(water=False):
    name='Clay vertex pigment' if not water else 'Opaque puddle pigment'
    if name in bpy.data.materials:return bpy.data.materials[name]
    m=bpy.data.materials.new(name);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Roughness'].default_value=.22 if water else .75
    p.inputs['Specular IOR Level'].default_value=.24
    c=m.node_tree.nodes.new('ShaderNodeVertexColor');c.layer_name='ClayColor'
    m.node_tree.links.new(c.outputs['Color'],p.inputs['Base Color']);return m

def finish(o,k):
    # Pigment is baked per vertex: warm darker undersides, bright tops, quiet clay variation.
    bpy.context.view_layer.objects.active=o
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    for f in o.data.polygons:f.use_smooth=True
    rgb=[linear(int(P[k][i:i+2],16)/255) for i in (0,2,4)]
    colors=o.data.color_attributes.new(name='ClayColor',type='BYTE_COLOR',domain='POINT')
    zs=[v.co.z for v in o.data.vertices];lo=min(zs);span=max(max(zs)-lo,.001)
    for v,c in zip(o.data.vertices,colors.data):
        h=(v.co.z-lo)/span
        wave=math.sin(v.co.x*17+v.co.y*13+v.co.z*11)*math.sin(v.co.z*23-v.co.x*9)
        shade=.88+.10*h+.035*max(0,v.normal.z)+.012*wave
        c.color=(*(min(1,x*shade) for x in rgb),1)
    o.data.materials.append(mat(k=='water'));o.parent=ROOT
    if BONE:o.vertex_groups.new(name=BONE).add(list(range(len(o.data.vertices))),1,'REPLACE')
    PARTS.append(o);return o

def apply(o,mod):
    bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)

def normalize(o,s):
    # Applied subdivision rounds the cage; restore exact authored extents.
    for i,d in enumerate((s[0],s[2],s[1])):
        lo=min(v.co[i] for v in o.data.vertices);hi=max(v.co[i] for v in o.data.vertices)
        for v in o.data.vertices:v.co[i]=(v.co[i]-(hi+lo)/2)*d/(hi-lo)

def ball(n,p,s,k,seg=16,rings=10,sub=0):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg,ring_count=rings,location=xyz(p))
    o=bpy.context.object;o.name=n
    if sub:
        m=o.modifiers.new('Applied sculpt subdivision 2','SUBSURF');m.levels=sub;apply(o,m)
    normalize(o,tuple(2*x for x in s));return finish(o,k)

def box(n,p,s,k,b=.04,segments=2,sub=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(p));o=bpy.context.object;o.name=n
    o.scale=(s[0],s[2],s[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if b:
        m=o.modifiers.new('Soft molded bevel','BEVEL');m.width=min(b,min(s)*.48);m.segments=1 if ROOT and ROOT.name in ('bakery','cafe','flower_shop','book_shop','house_rose','house_sage','sidewalk') and n not in ('Rounded plaster facade','Shop window recess','Shop window glass') else segments;apply(o,m)
    if sub:
        m=o.modifiers.new('Applied sculpt subdivision 2','SUBSURF');m.levels=sub;apply(o,m);normalize(o,s)
    # Smooth flat faces with bevel-aware custom normals.
    for f in o.data.polygons:f.use_smooth=True
    m=o.modifiers.new('Clay normals','WEIGHTED_NORMAL');m.keep_sharp=True;apply(o,m)
    return finish(o,k)

def tube(n,pts,r,k,res=2,sides=3):
    cu=bpy.data.curves.new(n,'CURVE');cu.dimensions='3D';cu.resolution_u=res
    sp=cu.splines.new('BEZIER');sp.bezier_points.add(len(pts)-1)
    for b,p in zip(sp.bezier_points,pts):b.co=xyz(p);b.handle_left_type='AUTO';b.handle_right_type='AUTO'
    cu.bevel_depth=r;cu.bevel_resolution=sides;cu.use_fill_caps=True
    o=bpy.data.objects.new(n,cu);bpy.context.collection.objects.link(o)
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH')
    return finish(o,k)

def disc(n,p,r,d,k,axis='z',vertices=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=d,location=xyz(p))
    o=bpy.context.object;o.name=n
    if axis=='z':o.rotation_euler.x=math.pi/2
    if axis=='x':o.rotation_euler.y=math.pi/2
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    m=o.modifiers.new('Rounded rim','BEVEL');m.width=min(d*.25,r*.15);m.segments=2;apply(o,m)
    return finish(o,k)

def profile(n,p,s,k,outline,sub=2):
    # Four supporting rings and two n-gon caps form a real volume; Catmull-Clark applied.
    vs=[];faces=[];N=len(outline)
    for scale,z in ((.90,-.5),(1,-.29),(1,.29),(.90,.5)):
        vs.extend(xyz((x*scale*s[0],y*scale*s[1],z*s[2])) for x,y in outline)
    faces.append(tuple(reversed(range(N))))
    for j in range(3):
        for i in range(N):faces.append((j*N+i,j*N+(i+1)%N,(j+1)*N+(i+1)%N,(j+1)*N+i))
    faces.append(tuple(range(3*N,4*N)))
    me=bpy.data.meshes.new(n);me.from_pydata(vs,[],faces);me.update()
    o=bpy.data.objects.new(n,me);bpy.context.collection.objects.link(o);o.location=xyz(p)
    bpy.context.view_layer.objects.active=o;o.select_set(True)
    # Fix winding consistently, regardless of profile point ordering.
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
    if sub:
        m=o.modifiers.new('Applied sculpt subdivision 2','SUBSURF');m.levels=sub;apply(o,m)
    normalize(o,s);return finish(o,k)

TOAST=[(-.37,-.5),(.37,-.5),(.45,-.46),(.46,.08),(.55,.27),(.50,.39),(.36,.48),(.16,.51),(-.16,.51),(-.36,.48),(-.50,.39),(-.55,.27),(-.46,.08),(-.45,-.46)]

def group(n):
    global ROOT,PARTS
    ROOT=bpy.data.objects.new(n,None);bpy.context.collection.objects.link(ROOT);PARTS=[]
    ROOT['units']='metres';ROOT['forward']='+Z';return ROOT

def joined(n):
    global PARTS
    bpy.ops.object.select_all(action='DESELECT')
    for o in PARTS:o.select_set(True)
    bpy.context.view_layer.objects.active=PARTS[0];bpy.ops.object.join();o=bpy.context.object;o.name=n
    bpy.context.scene.cursor.location=(0,0,0);bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    # Bake component rotation too, leaving library roots and children identity.
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=True);PARTS=[o];return o

def clear():
    global ROOT,PARTS,BONE
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False);ROOT=None;PARTS=[];BONE=None

def export(name,anim=False):
    bpy.ops.export_scene.gltf(filepath=str(OUT/(name+'.glb')),export_format='GLB',export_yup=True,export_texcoords=False,export_animations=anim,export_animation_mode='ACTIONS',export_force_sampling=True,export_optimize_animation_size=False,export_extras=True,export_cameras=False,export_lights=False)
    print('EXPORTED',name,flush=True)

def loaf(p=(0,.13,0),s=1,detail=16):
    x,y,z=p
    ball('Slow proved golden loaf',p,(.225*s,.13*s,.135*s),'bread',detail,20 if detail>=32 else 10)
    for dx in (-.105,0,.105):
        if detail<=12:
            ball('Small flour score',(x+dx*s,y+.121*s,z),(.013*s,.012*s,.085*s),'score',8,4)
            continue
        tube('Raised flour score',[(x+(dx-.028)*s,y+.07*s,z+.10*s),(x+dx*s,y+.128*s,z+.025*s),(x+(dx+.028)*s,y+.09*s,z-.09*s)],.012*s,'score',3,2)

def baguette(p,s=1):
    x,y,z=p;ball('Baguette',p,(.065*s,.23*s,.065*s),'bread',16,12)
    for dy in (-.12,-.04,.04,.12):
        tube('Diagonal baguette score',[(x-.038*s,y+(dy-.024)*s,z+.05*s),(x,y+dy*s,z+.066*s),(x+.034*s,y+(dy+.024)*s,z+.05*s)],.008*s,'score',2,2)

def bag(p=(0,0,0),s=1):
    x,y,z=p
    box('Soft folded kraft bag',(x,y+.245*s,z),(.38*s,.49*s,.23*s),'kraft',.025*s,3)
    box('Dark inside opening',(x,y+.49*s,z),(.34*s,.012*s,.19*s),'soil',.01*s)
    for zz in (-.118,.118):box('Rolled paper lip',(x,y+.49*s,z+zz*s),(.40*s,.035*s,.026*s),'score',.012*s)
    for xx in (-.19,.19):box('Folded side lip',(x+xx*s,y+.49*s,z),(.025*s,.035*s,.24*s),'kraft',.01*s)
    for side in (-1,1):
        tube('Diagonal paper fold',[(x+side*.16*s,y+.04*s,z-.121*s),(x+side*.11*s,y+.12*s,z-.125*s),(x+side*.16*s,y+.24*s,z-.121*s)],.005*s,'crust',2,2)
    disc('Round bakery seal',(x,y+.26*s,z-.123*s),.065*s,.009*s,'rose')
    baguette((x-.08*s,y+.61*s,z),s)
    loaf((x+.09*s,y+.53*s,z),.55*s,12)


def bunny():
    global BONE,ROOT
    clear();root=group('bunny')
    BONE='body'
    ball('Soft pear body',(0,.46,0),(.225,.30,.17),'fur',8,5,2)
    ball('Cotton tail',(0,.27,-.20),(.095,.095,.09),'fur',8,5,2)
    profile('Cocoa apron skirt',(0,.39,.155),(.43,.34,.085),'wood',[(-.5,-.5),(.5,-.5),(.46,-.1),(.32,.5),(-.32,.5),(-.46,-.1)],2)
    box('Apron bib',(0,.60,.16),(.23,.21,.06),'wood',.035,2,2)
    box('Apron pocket',(0,.38,.204),(.16,.115,.023),'kraft',.018,3)
    for side in (-1,1):
        tube('Apron shoulder strap',[(side*.10,.55,.205),(side*.13,.69,.13),(side*.14,.69,-.11),(side*.14,.46,-.165)],.021,'wood',4,3)
        disc('Apron button',(side*.08,.65,.199),.012,.007,'score',vertices=12)
    bag((0,.32,-.285),.80)
    for x in (-.16,.16):tube('Backpack strap',[(x,.38,-.24),(x,.70,-.20),(x,.72,.06),(x,.44,.16)],.014,'kraft',3,3)
    BONE='head'
    profile('Toast crust rim',(0,.975,0),(.79,.61,.30),'crust',TOAST,2)
    profile('Soft toast face',(0,.981,.025),(.755,.577,.285),'fur',TOAST,2)
    for side in (-1,1):
        ball('Chocolate dot eye',(side*.142,.976,.172),(.024,.025,.016),'dark',16,10)
        ball('Rosy cheek',(side*.231,.908,.164),(.047,.034,.014),'pink',16,10)
    ball('Tiny nose',(0,.93,.185),(.016,.011,.010),'dark',12,8)
    for side in (-1,1):
        tube('Omega smile',[(0,.926,.188),(side*.014,.904,.189),(side*.034,.904,.187),(side*.048,.919,.182)],.0075,'dark',4,3)
    for side,label in ((-1,'L'),(1,'R')):
        BONE='ear'+label
        o=ball('Long soft ear',(side*.22,1.392,-.012),(.070,.210,.055),'fur',8,5,2);o.rotation_euler.y=side*.16
        o=ball('Pink inner ear',(side*.223,1.410,.034),(.034,.150,.014),'pink',8,5,2);o.rotation_euler.y=side*.16
        BONE='leg'+label
        ball('Thigh',(side*.125,.23,0),(.095,.16,.105),'fur',8,5,2)
        ball('Soft paw',(side*.13,.075,.060),(.103,.075,.153),'fur',8,5,2)
        BONE='arm'+label
        ball('Rounded arm',(side*.251,.48,.04),(.075,.18,.08),'fur',8,5,2)
    mesh=joined('BunnyClay');BONE=None
    bpy.ops.object.armature_add();rig=bpy.context.object;rig.name='BunnyRig'
    bpy.ops.object.mode_set(mode='EDIT');rig.data.edit_bones.remove(rig.data.edit_bones[0])
    points={'body':(0,.40,0),'head':(0,.72,0),'earL':(-.19,1.20,-.012),'earR':(.19,1.20,-.012),'legL':(-.125,.31,0),'legR':(.125,.31,0),'armL':(-.23,.63,0),'armR':(.23,.63,0)}
    for name,p in points.items():
        b=rig.data.edit_bones.new(name);b.head=xyz(p);b.tail=xyz((p[0],p[1]+.15,p[2]))
        if name!='body':b.parent=rig.data.edit_bones['head' if name.startswith('ear') else 'body']
    bpy.ops.object.mode_set(mode='OBJECT');mesh.parent=None;bpy.data.objects.remove(root,do_unlink=True)
    mod=mesh.modifiers.new('One armature','ARMATURE');mod.object=rig
    rig.animation_data_create();bpy.context.scene.render.fps=24
    for name,count in [('run',25),('jump',25),('slide',25),('leanL',13),('leanR',13),('crash',21),('idle',49)]:
        action=bpy.data.actions.new(name);action.use_fake_user=True;rig.animation_data.action=action
        for f in range(count):
            t=f/(count-1);wave=math.sin(t*math.tau)
            for bone in rig.pose.bones:
                bone.rotation_mode='XYZ';bone.rotation_euler=(0,0,0);bone.location=(0,0,0);bone.scale=(1,1,1)
            b=rig.pose.bones['body'];head=rig.pose.bones['head']
            if name=='run':
                bounce=.5-.5*math.cos(t*math.tau*2);stretch=.96+.09*bounce
                b.scale=(1/math.sqrt(stretch),stretch,1/math.sqrt(stretch));b.location.y=.025+.035*bounce
                b.rotation_euler.x=-.12;b.rotation_euler.z=.045*wave
                head.rotation_euler.x=.08+.035*math.sin(t*math.tau*2-.6)
                for s,l in ((1,'L'),(-1,'R')):
                    rig.pose.bones['leg'+l].rotation_euler.x=s*.72*wave
                    rig.pose.bones['arm'+l].rotation_euler.x=-s*.62*wave-.10
                    rig.pose.bones['ear'+l].rotation_euler.x=.18*math.sin(t*math.tau*2-.8+s*.18)
                    rig.pose.bones['ear'+l].rotation_euler.z=s*.07+.06*math.sin(t*math.tau-.5)
            elif name=='jump':
                anticipation=math.sin(math.pi*min(t/.25,1)) if t<.25 else 0
                airborne=math.sin(math.pi*max(0,(t-.25)/.75))
                stretch=1-.14*anticipation+.10*max(0,math.sin((t-.25)*math.tau))
                b.scale=(1/math.sqrt(stretch),stretch,1/math.sqrt(stretch));b.location.y=-.045*anticipation
                b.rotation_euler.x=-.16*airborne+.12*anticipation
                for s,l in ((1,'L'),(-1,'R')):
                    rig.pose.bones['leg'+l].rotation_euler.x=.95*airborne-.22*anticipation
                    rig.pose.bones['arm'+l].rotation_euler.x=-.75*airborne
                    rig.pose.bones['ear'+l].rotation_euler.x=.30*math.sin(math.pi*t)*math.sin(t*math.tau-.7)
            elif name=='slide':
                b.location.y=-.20;b.rotation_euler.x=1.02+.02*wave;b.scale=(1.04,.90,1.04)
                head.rotation_euler.x=-.46
                for l in ('L','R'):
                    rig.pose.bones['leg'+l].rotation_euler.x=-1.30
                    rig.pose.bones['arm'+l].rotation_euler.x=.55
                    rig.pose.bones['ear'+l].rotation_euler.x=.45+.04*wave
            elif name.startswith('lean'):
                sign=1 if name=='leanL' else -1;e=math.sin(t*math.pi/2)
                b.rotation_euler.z=sign*.30*e;head.rotation_euler.z=-sign*.10*e
                for l in ('L','R'):rig.pose.bones['ear'+l].rotation_euler.z=-sign*.18*e
            elif name=='crash':
                e=1-(1-t)**2;b.rotation_euler.x=-1.32*e;b.location.y=-.14*e
                head.rotation_euler.x=.18*math.sin(math.pi*t)
                for s,l in ((1,'L'),(-1,'R')):
                    rig.pose.bones['arm'+l].rotation_euler.z=s*.65*e
                    rig.pose.bones['leg'+l].rotation_euler.x=.45*e
                    rig.pose.bones['ear'+l].rotation_euler.x=-.40*math.sin(math.pi*t)
            else:
                breath=.5-.5*math.cos(t*math.tau);b.scale=(1+.008*breath,1+.016*breath,1+.008*breath)
                head.rotation_euler.z=.018*wave
                for s,l in ((1,'L'),(-1,'R')):rig.pose.bones['ear'+l].rotation_euler.z=s*.025*wave
            bpy.context.view_layer.update();evaluated=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
            floor=min((evaluated.matrix_world@v.co).z for v in evaluated.data.vertices)
            b.location.y+=max(0,.003-floor)
            for bone in rig.pose.bones:
                for channel in ('rotation_euler','location','scale'):bone.keyframe_insert(channel,frame=f+1)
        for fc in action.fcurves:
            for key in fc.keyframe_points:key.interpolation='LINEAR'
    rig.animation_data.action=None
    for b in rig.pose.bones:b.rotation_euler=(0,0,0);b.location=(0,0,0);b.scale=(1,1,1)
    bpy.context.scene.frame_set(1);export('bunny',True)


def awning(width=1.8,height=1.1,depth=.8,color='rose',posts=True,z=0,architectural=False):
    if posts:
        for x in (-width/2+.045,width/2-.045):
            box('Turned canopy post',(x,(height+.24)/2,z),(.075,height+.24,.075),'wood',.03)
            disc('Post finial',(x,height+.255,z),.055,.08,'bread','y',16)
    for i in range(8):
        w=width/8;x=-width/2+(i+.5)*w;k='cream' if i%2 else color
        # Canopy slopes down toward the front; semicircular scallops hang below it.
        o=box('Canvas canopy',(x,height+.20,z),(w,.075,depth),k,.026,3);o.rotation_euler.x=.12
        profile('Round scalloped valance',(x,height+.055,z+depth/2-.025),(w,.17,.045),k,[(-.5,.5),(.5,.5)]+[(.5*math.cos(a*math.pi/8),-.5*math.sin(a*math.pi/8)) for a in range(9)],0 if architectural else 1)

ROUNDRECT=[(-.38,-.5),(.38,-.5),(.5,-.30),(.5,.30),(.38,.5),(-.38,.5),(-.5,.30),(-.5,-.30)]

def wheel_arch(x,z,k):
    # Swept fender with a bevel-like four-sided section, entirely inside the footprint.
    verts=[];faces=[];side=1 if x>0 else -1
    for i in range(9):
        a=math.pi*i/8
        for xx,r in ((x-side*.025,.265),(x+side*.025,.275),(x+side*.025,.315),(x-side*.025,.325)):
            verts.append(xyz((xx,.245+math.sin(a)*r,z+math.cos(a)*r)))
    for i in range(8):
        for j in range(4):faces.append((4*i+j,4*i+(j+1)%4,4*(i+1)+(j+1)%4,4*(i+1)+j))
    faces.extend([(3,2,1,0),(32,33,34,35)])
    me=bpy.data.meshes.new('Sculpted wheel arch');me.from_pydata(verts,[],faces);me.update()
    o=bpy.data.objects.new('Sculpted wheel arch',me);bpy.context.collection.objects.link(o)
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
    finish(o,k)

def vehicle(color):
    box('Rounded cargo body',(0,.72,-.66),(1.80,1.04,4.60),color,.18,2)
    box('Rounded driver cab',(0,.72,2.10),(1.80,1.04,1.76),color,.22,3)
    box('Flat walkable roof',(0,1.24,0),(1.90,.12,6),color,.055,2)
    box('Rear cargo opening',(0,.75,-2.972),(1.44,.83,.022),'wood',.12,3)
    box('Rear inset panel',(0,.76,-2.986),(1.25,.67,.012),'kraft',.10,2)
    box('Rear door seam',(0,.75,-2.995),(.018,.68,.008),'soil',.003,2)
    for x in (-.18,.18):box('Rear latch',(x,.67,-2.997),(.13,.045,.006),'cream',.002,2)
    profile('Panoramic windshield',(0,.98,2.963),(1.46,.40,.035),'glass',ROUNDRECT,1)
    box('Soft front bumper',(0,.265,2.94),(1.63,.12,.12),'cream',.05,3)
    box('Rear bumper',(0,.24,-2.94),(1.65,.10,.12),'cream',.045,3)
    for x in (-.64,.64):
        disc('Cream headlamp',(x,.57,2.975),.105,.04,'score',vertices=20)
        disc('Tail light',(x,.48,-2.978),.066,.038,'rose',vertices=16)
        for z in (-1.95,1.95):
            # Insets + two layers make readable rubber tires and cream hubcaps.
            wheel_arch(math.copysign(.915,x),z,color)
            disc('Cocoa tire',(math.copysign(.855,x),.245,z),.245,.18,'dark','x',20)
            disc('Cream wheel hub',(math.copysign(.949,x),.245,z),.143,.002,'cream','x',12)
            disc('Hub centre',(math.copysign(.9495,x),.245,z),.060,.001,'kraft','x',8)
    for side in (-1,1):
        o=profile('Driver window',(side*.910,.985,2.10),(1.05,.37,.022),'glass',ROUNDRECT,1);o.rotation_euler.z=side*math.pi/2
        box('Door seam',(side*.906,.61,1.46),(.012,.66,.018),'wood',.005,2)
        box('Door handle',(side*.921,.71,1.64),(.035,.035,.16),'cream',.014,3)
        box('Bakery signboard',(side*.906,.85,-.57),(.032,.47,1.55),'cream',.015,3)
        # Wheat/loaf icon, no letterforms.
        ball('Bread icon',(side*.934,.85,-.57),(.015,.14,.40),'bread',16,10)
        for z in (-.80,-.57,-.34):tube('Loaf sign scoring',[(side*.95,.79,z-.05),(side*.95,.87,z),(side*.95,.93,z+.05)],.012,'score',2,2)
        box('Side sill',(side*.888,.28,-.1),(.04,.10,3.15),'cream',.015,3)

def ramp():
    a=math.atan2(1.3,2);length=math.hypot(1.3,2)
    for i in range(12):
        z=-1+(i+.5)*2/12;y=(z+1)*.65
        o=box('Individual wooden ramp plank',(0,y,z),(1.7,.055,length/12-.008),'kraft',.012,3);o.rotation_euler.x=-a
        for side in (-1,1):disc('Inset wooden peg',(side*.71,y+.030,z),.018,.008,'wood','y',12)
    for side in (-1,1):
        o=box('Long ramp stringer',(side*.68,.59,0),(.12,.10,length),'wood',.025,3);o.rotation_euler.x=-a
    for z in (-.5,0,.5):
        o=box('End grain batten',(0,(z+1)*.65-.09,z),(1.52,.09,.10),'wood',.015,3);o.rotation_euler.x=-a
    o=joined('rampMesh')
    for i,target in enumerate((1.7,2,1.3)):
        lo=min(v.co[i] for v in o.data.vertices);hi=max(v.co[i] for v in o.data.vertices)
        for v in o.data.vertices:v.co[i]=(v.co[i]-lo)*target/(hi-lo)-(target/2 if i!=2 else 0)
    return o

def lathe(n,p,profile,k,segments=32):
    vs=[];faces=[]
    for y,r in profile:
        for i in range(segments):
            a=i*math.tau/segments;vs.append(xyz((r*math.cos(a),y,r*math.sin(a))))
    for j in range(len(profile)-1):
        for i in range(segments):faces.append((j*segments+i,(j+1)*segments+i,(j+1)*segments+(i+1)%segments,j*segments+(i+1)%segments))
    me=bpy.data.meshes.new(n);me.from_pydata(vs,[],faces);me.update();o=bpy.data.objects.new(n,me);bpy.context.collection.objects.link(o);o.location=xyz(p);return finish(o,k)

def flower(p,s=1,color='pink',detail=6):
    x,y,z=p
    for i in range(5):
        a=i*math.tau/5;ball('Clay petal',(x+math.cos(a)*.057*s,y+math.sin(a)*.057*s,z),(.045*s,.045*s,.026*s),color,detail,4)
    ball('Flower centre',(x,y,z+.024*s),(.025*s,.025*s,.018*s),'score',detail,4)

def planter(p=(0,0,0),s=1,flowers=True):
    x,y,z=p
    box('Terracotta planter',(x,y+.16*s,z),(.80*s,.32*s,.35*s),'roof',.045*s,3)
    box('Planter rim',(x,y+.31*s,z),(.85*s,.07*s,.40*s),'rose',.025*s,3)
    box('Soil',(x,y+.341*s,z),(.73*s,.015*s,.29*s),'soil',.005*s,2)
    for i in range(3):
        xx=x+(i-1)*.24*s
        ball('Leaves',(xx,y+.38*s,z),(.16*s,.09*s,.16*s),'leaf',10,6)
        if flowers:flower((xx,y+.43*s,z+.11*s),.8*s)

def props():
    clear()
    for n in ['cart','flour','awning','puddle','ramp','van','truck','bread','bag','coffee','lamp','tree','bench']:
        group(n)
        if n=='cart':
            box('Bread cart',(0,.56,0),(1.78,.48,.82),'kraft',.075,4)
            for x in (-.66,.66):
                disc('Cart tire',(x,.18,0),.18,.12,'wood','x',24)
                disc('Cart hub',(x+math.copysign(.065,x),.18,0),.09,.018,'cream','x',16)
            for x in (-.65,-.32,0,.32,.65):box('Cart board seam',(x,.56,.417),(.013,.35,.015),'wood',.005,2)
            box('Counter lip',(0,.84,0),(1.8,.10,.96),'wood',.035,3)
            awning(1.8,1.10,.96,'sage');
            for x in (-.52,0,.52):loaf((x,1.0,.03),.80,12)
        elif n=='flour':
            for x,y,z in [(-.25,.26,0),(.25,.26,0),(0,.69,.02)]:
                ball('Folded flour sack',(x,y,z),(.28,.26 if y<.5 else .21,.25),'cream',20,14)
                tube('Gathered sack seam',[(x-.20,y+.09,z+.17),(x,y+.14,z+.23),(x+.20,y+.09,z+.17)],.015,'kraft',4,3)
                ball('Sack knot',(x,y+.17,z+.12),(.075,.035,.05),'kraft',12,8)
                disc('Flour sack seal',(x,y-.01,z+.246),.075,.012,'rose',vertices=16)
        elif n=='awning':awning()
        elif n=='puddle':ball('Soft irregular puddle',(0,.012,0),(.85,.012,.55),'water',48,24)
        elif n=='ramp':ramp();continue
        elif n in ('van','truck'):vehicle('sage' if n=='van' else 'rose')
        elif n=='bread':
            loaf((0,.13,0),1,40)
            tube('Baked lower crust',[(.21*math.cos(i*math.tau/24),.085,.118*math.sin(i*math.tau/24)) for i in range(25)],.008,'crust',2,2)
        elif n=='bag':bag()
        elif n=='coffee':
            lathe('Tapered clay cup',(0,0,0),[(0,.085),(.012,.092),(.04,.095),(.10,.103),(.22,.12),(.31,.132),(.33,.132),(.335,.125),(.32,.118),(.29,.117)],'cream',40)
            lathe('Kraft cup sleeve',(0,0,0),[(.10,.106),(.105,.111),(.19,.122),(.23,.127),(.235,.122)],'kraft',40)
            lathe('Molded coffee lid',(0,0,0),[(.325,.132),(.33,.144),(.35,.144),(.36,.132),(.375,.128),(.38,.115),(.38,.001)],'wood',40)
            disc('Cup medallion',(0,.17,.12),.04,.009,'cream',vertices=20)
            disc('Lid inset',(0,.379,0),.115,.006,'wood','y',16)
            box('Sip opening',(0,.382,.085),(.055,.006,.017),'dark',.002,3)
        elif n=='lamp':
            lathe('Turned lamp base',(0,0,0),[(0,.18),(.03,.18),(.07,.14),(.15,.12),(.21,.075),(.26,.045),(2.61,.045),(2.64,.09)],'wood',32)
            box('Lantern glass',(0,2.84,0),(.28,.40,.28),'cream',.035,4)
            for x in (-.15,.15):
                for z in (-.15,.15):box('Lantern corner frame',(x,2.84,z),(.025,.45,.025),'wood',.01,3)
            lathe('Lantern cap',(0,0,0),[(3.04,.23),(3.09,.22),(3.13,.12),(3.16,.025)],'wood',32)
            disc('Lantern finial',(0,3.135,0),.026,.05,'bread','y',12)
            disc('Lantern base',(0,2.60,0),.21,.065,'wood','y',24)
        elif n=='tree':
            lathe('Tree planter',(0,0,0),[(0,.28),(.04,.30),(.39,.39),(.43,.42),(.47,.42),(.49,.36),(.46,.34)],'roof',24)
            disc('Soil',(0,.465,0),.35,.02,'soil','y',20)
            tube('Tree trunk',[(0,.45,0),(.03,1.1,.03),(-.05,1.65,0)],.085,'wood',3,3)
            for x,y,z,s in [(0,2,0,.59),(-.38,1.73,0,.43),(.38,1.82,.12,.45),(0,2.28,.10,.38),(.12,1.72,-.32,.40)]:ball('Molded leafy crown',(x,y,z),(s,s,s),'sage',18,12)
        else:
            for z in (-.18,0,.18):box('Rounded seat slat',(0,.48,z),(1.6,.08,.145),'kraft',.025,4)
            for y in (.72,.94):box('Rounded back slat',(0,y,-.25),(1.6,.14,.075),'kraft',.025,4)
            for x in (-.60,.60):
                tube('Curved bench leg',[(x,.04,.22),(x,.43,.13),(x,.43,-.13),(x,.04,-.22)],.043,'wood',4,3)
                tube('Curved back support',[(x,.39,-.22),(x,.7,-.28),(x,1.01,-.28)],.035,'wood',3,3)
                for y in (.72,.94):disc('Bench peg',(x,y,-.207),.016,.012,'cream',vertices=12)
        joined(n+'Mesh')
    export('props')


def cobble(x,z,k,width=.478):
    outline=[]
    for cx,cz,start in ((.17,.17,0),(-.17,.17,90),(-.17,-.17,180),(.17,-.17,270)):
        for i in range(4):
            a=math.radians(start+i*30);outline.append((cx+.069*math.cos(a),cz+.069*math.sin(a)))
    vs=[xyz((x,.012,z)),xyz((x,0,z))]+[xyz((x+xx*width/.478,.004,z+zz)) for xx,zz in outline]
    faces=[]
    for i in range(16):faces.extend([(0,2+(i+1)%16,2+i),(1,2+i,2+(i+1)%16)])
    me=bpy.data.meshes.new('Rounded cobble');me.from_pydata(vs,[],faces);me.update()
    o=bpy.data.objects.new('Rounded cobble',me);bpy.context.collection.objects.link(o);finish(o,k)
    normals=[(0,0,1),(0,0,-1)]+[Vector((xx*.9,-zz*.9,.90)).normalized() for xx,zz in outline]
    me.normals_split_custom_set_from_vertices(normals)

def town(variants=None):
    clear()
    for n in (variants if variants is not None else ['bakery','cafe','flower_shop','book_shop','house_rose','house_sage']):
        index=['bakery','cafe','flower_shop','book_shop','house_rose','house_sage','patisserie','cheese_shop','tea_house','corner_house'].index(n)
        group(n);color=['plaster','rose','cream','sage','rose','sage','cream','plaster','sage','rose'][index]
        box('Rounded plaster facade',(0,3.35,0),(6,6.7,4),color,.07,2)
        box('Roof cap',(0,6.80,0),(6,.18,4),'roof',.04,2)
        for y in (.18,3.15,6.5):box('Cream cornice',(0,y,2.035),(6,.15,.13),'cream',.025,2)
        # Two rows of rounded terracotta roof tiles at front and rear eaves.
        for z in (-1.78,1.78):
            for i in range(15):ball('Terracotta roof tile',(-2.8+i*.4,6.89,z),(.198,.11,.22),'roof' if i%3 else 'rose',8,4)
        for x in (-1.9,0,1.9):
            for y in (4.15,5.6):
                box('Deep window recess',(x,y,2.025),(1.12,1.12,.08),'wood',.065,2)
                box('Glazed pane',(x,y,2.079),(.92,.91,.036),'glass',.06,2)
                for dx in (-.53,.53):box('Window jamb',(x+dx,y,2.13),(.10,1.16,.17),'cream',.025,2)
                for dy in (-.53,.53):box('Window lintel',(x,y+dy,2.13),(1.12,.10,.17),'cream',.025,2)
                box('Window mullion',(x,y,2.15),(.045,.96,.055),'cream',.012,2)
                box('Window transom',(x,y+.12,2.15),(.96,.045,.055),'cream',.012,2)
                box('Deep window sill',(x,y-.60,2.16),(1.25,.10,.33),'cream',.025,2)
            if x!=0 or index%2==0:planter((x,3.31,2.21),.88,True)
        box('Door recess',(0,1.27,2.055),(1.22,2.54,.13),'wood',.13,2)
        box('Sage door',(0,1.27,2.135),(1.04,2.36,.11),'sage' if index%2==0 else 'wood',.08,2)
        box('Door glass',(0,1.63,2.20),(.78,1.30,.03),'glass',.09,2)
        box('Door lower panel',(0,.55,2.21),(.78,.48,.025),'kraft',.04,2)
        ball('Brass knob',(.35,1.03,2.25),(.045,.045,.035),'bread',12,8)
        box('Doorstep',(0,.07,2.20),(1.40,.14,.70),'stone',.04,2)
        for x in (-1.95,1.95):
            box('Shop window recess',(x,1.58,2.07),(1.60,1.90,.14),'wood',.15,2)
            box('Shop window glass',(x,1.60,2.16),(1.40,1.66,.05),'glass',.12,2)
            box('Display ledge',(x,.68,2.20),(1.68,.10,.30),'cream',.025,2)
            box('Shop window bar',(x,1.62,2.22),(1.42,.055,.05),'cream',.016,2)
            if index==0:
                for dx in (-.42,0,.42):loaf((x+dx,1.0,2.22),.60,10)
            elif index==3:
                for i in range(5):box('Window books',(x-.50+i*.23,1.05+(i%2)*.04,2.23),(.15,.52+(i%2)*.08,.10),'rose' if i%2 else 'cream',.018,2)
        awning(5.75,2.55,.62,'sage' if index%2 else 'rose',False,2.30,True)
        box('Framed shop sign',(0,3.04,2.16),(2.20,.47,.15),'wood',.10,2)
        box('Sign inset',(0,3.04,2.245),(2.02,.33,.028),'cream',.08,2)
        if index==0:loaf((0,3.03,2.30),1.1,12)
        elif index==1:
            box('Cup icon',(0,3.04,2.29),(.25,.23,.075),'wood',.06,2)
            tube('Cup handle',[(.11,3.10,2.29),(.22,3.10,2.29),(.22,3.00,2.29),(.12,2.99,2.29)],.023,'wood',3,2)
        elif index==2:flower((0,3.04,2.28),1.45,'rose')
        elif index==3:
            for i in range(3):box('Book icon',(-.18+i*.18,3.04,2.29),(.13,.25,.07),['rose','sage','wood'][i],.018,2)
        else:
            profile('Toast house plaque',(0,3.04,2.29),(.30,.25,.06),'bread',TOAST,1)
        joined(n+'Mesh')
    group('sidewalk')
    box('Continuous paving base',(0,.075,0),(2,.15,6),'stone',.025,2)
    for z in (-2.5,-1.5,-.5,.5,1.5,2.5):
        for x in (-.46,.46):box('Rounded paving slab',(x,.16,z),(.88,.04,.98),'cream',.014,2)
        for x in (-.96,.96):box('Bevelled curb block',(x,.12,z),(.08,.12,.985),'stone',.025,2)
    # Planters sit on the outer strip, inside the original 2 x 6 tile footprint.
    planter((.53,.18,2.25),.85,True)
    joined('sidewalkMesh')
    group('road');box('Continuous road bed',(0,-.035,0),(8,.07,6),'grout',0)
    for row in range(12):
        cells=[(-3.75+col*.5,.478) for col in range(16)] if row%2==0 else [(-3.875,.228)]+[(-3.5+col*.5,.478) for col in range(15)]+[(3.875,.228)]
        for col,(x,width) in enumerate(cells):
            z=-2.75+row*.5
            cobble(x,z,['cobble','stone','sandstone','warmstone'][(col*7+row*3)%4],width)
    for x in (-8/6,8/6):
        for z in (-2,0,2):box('Inlaid cream lane mark',(x,.018,z),(.065,.012,.65),'cream',.005,2)
    joined('roadMesh');export('town')


def import_library(file):
    old=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(OUT/(file+'.glb')))
    new=set(bpy.data.objects)-old;roots=[o for o in new if not o.parent]
    for o in new:
        for c in list(o.users_collection):c.objects.unlink(o)
    return {o.name.split('.')[0]:o for o in roots}

def instance(source,p=(0,0,0),yaw=0):
    def clone(o,parent=None):
        c=o.copy();bpy.context.collection.objects.link(c);c.parent=parent
        for child in o.children:clone(child,c)
        return c
    c=clone(source);c.location=xyz(p);c.rotation_mode='XYZ';c.rotation_euler=(0,0,yaw);return c

def light_scene(close=False):
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=96;scene.cycles.use_denoising=bpy.app.version>=(5,0,0);scene.cycles.seed=12
    scene.world.use_nodes=True;bg=scene.world.node_tree.nodes['Background'];bg.inputs[0].default_value=(.78,.70,.58,1);bg.inputs[1].default_value=.55
    bpy.ops.object.light_add(type='AREA',location=xyz((-3,6,4) if close else (-5,10,-1)))
    bpy.context.object.data.color=(1,.85,.68);bpy.context.object.data.energy=650 if close else 1500;bpy.context.object.data.shape='DISK';bpy.context.object.data.size=5
    light=bpy.context.object;light.rotation_euler=(Vector(xyz((0,.7,0)))-light.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.object.light_add(type='AREA',location=xyz((4,3,-2)))
    bpy.context.object.data.color=(1,.95,.87);bpy.context.object.data.energy=200 if close else 500;bpy.context.object.data.size=5
    light=bpy.context.object;light.rotation_euler=(Vector(xyz((0,1,0)))-light.location).to_track_quat('-Z','Y').to_euler()
    if not close:
        bpy.ops.object.light_add(type='SUN');bpy.context.object.rotation_euler=(.4,-.5,-.4);bpy.context.object.data.energy=1.5;bpy.context.object.data.angle=.18
    scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=.5
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB';scene.render.image_settings.compression=100
    scene.render.resolution_percentage=100

def camera(pos,target,lens=32):
    bpy.ops.object.camera_add(location=xyz(pos));cam=bpy.context.object
    cam.rotation_euler=(Vector(xyz(target))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.lens=lens;bpy.context.scene.camera=cam

def load_bunny(p=(0,0,0)):
    old=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(OUT/'bunny.glb'))
    roots=[o for o in set(bpy.data.objects)-old if not o.parent]
    root=bpy.data.objects.new('BunnyPreview',None);bpy.context.collection.objects.link(root)
    for o in roots:o.parent=root
    root.location=xyz(p);return root

def preview():
    clear();townlib=import_library('town');proplib=import_library('props')
    for z in (0,6,12,18,24):
        instance(townlib['road'],(0,0,z))
        for x in (-5,5):instance(townlib['sidewalk'],(x,0,z),math.pi if x<0 else 0)
    for side in (-1,1):
        for i,n in enumerate(['bakery','cafe','flower_shop','house_rose'] if side<0 else ['book_shop','house_rose','house_sage','bakery']):instance(townlib[n],(side*8,.18,3+i*6),-side*math.pi/2)
    bunnyroot=load_bunny((0,.024,-.5))
    rig=next(o for o in bunnyroot.children if o.type=='ARMATURE');rig.animation_data.action=next(a for a in bpy.data.actions if a.name.startswith('run_'));bpy.context.scene.frame_set(5)
    instance(proplib['cart'],(-2.5,.024,4));instance(proplib['van'],(2.5,.024,10));instance(proplib['ramp'],(2.5,.024,6))
    for z in (2,9,16):
        instance(proplib['lamp'],(-4.5,.18,z));instance(proplib['tree'],(4.8,.18,z+1))
    for z in (2.5,4,5.5):instance(proplib['bread'],(0,.55,z))
    light_scene();camera((0,4.6,-7.5),(0,1.2,3),32)
    scene=bpy.context.scene;scene.render.resolution_x=480;scene.render.resolution_y=600
    scene.render.filepath=str(OUT/'preview.png');bpy.ops.render.render(write_still=True)

def closeup():
    clear();root=load_bunny();rig=next(o for o in root.children if o.type=='ARMATURE')
    rig.animation_data.action=None
    for b in rig.pose.bones:b.rotation_mode='XYZ';b.rotation_euler=(0,0,0);b.location=(0,0,0);b.scale=(1,1,1)
    # A three-quarter front portrait, so the toast silhouette, apron and bag are reviewable.
    global ROOT,PARTS
    ROOT=None;PARTS=[]
    box('Studio floor',(0,-.065,0),(200,.10,200),'cream',0)
    light_scene(True);camera((2.15,1.72,4.5),(0,.81,0),76)
    scene=bpy.context.scene;scene.render.resolution_x=512;scene.render.resolution_y=608
    scene.render.filepath=str(OUT/'bunny-closeup.png');bpy.ops.render.render(write_still=True)

if __name__=='__main__':
    if '--preview-only' not in sys.argv:
        bunny();props();town()
    if '--models-only' not in sys.argv:preview();closeup()

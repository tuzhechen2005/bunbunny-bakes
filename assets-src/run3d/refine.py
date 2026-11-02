"""R16 clay refinement. Blender 4.3.2; all inputs and outputs remain in run3d.

Keeps the original rig/actions and procedural coordinate helpers. Every component
receives deterministic pigment variation, and every joined asset receives a
short-range geometry-occlusion bake into its POINT vertex colours.
"""
import sys, os, math, hashlib, json
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
os.environ.setdefault('RUN3D_OUT',str(HERE/'.cache/raw'))
import render as r
import mechanics as m

FACADES=['bakery','cafe','flower_shop','book_shop','house_rose','house_sage',
         'patisserie','cheese_shop','tea_house','corner_house']
NEW_PROPS=['planter','bicycle','crate_stack','menu_board','bunting']
original_join=r.joined
original_finish=r.finish
original_box=r.box
original_cobble=r.cobble
original_export=r.export
inventory={}


def finish(o,k):
    # Round the remaining custom polygon profiles and swept arch edges too.
    if o.name.startswith(('Round scalloped','Sculpted wheel arch','Broken cobble')):
        mod=o.modifiers.new('R16 soft silhouette edges','BEVEL')
        mod.width=.006;mod.segments=2;mod.limit_method='ANGLE';mod.angle_limit=.55
        r.apply(o,mod)
    o=original_finish(o,k)
    seed=int.from_bytes(hashlib.sha256((o.name+str(tuple(round(c,3) for c in o.location))).encode()).digest()[:4],'little')
    tint=.978+(seed%1000)/1000*.044
    colors=o.data.color_attributes['ClayColor']
    for v,c in zip(o.data.vertices,colors.data):
        # Broad, quiet pigment mottling, not high-frequency texture noise.
        noise=.009*math.sin(v.co.x*21+v.co.z*14+seed%29)
        c.color=(*(max(0,min(1,x*(tint+noise))) for x in c.color[:3]),1)
    return o


def box(n,p,s,k,b=.04,segments=2,sub=0):
    # Bypass the earlier architectural one-segment cost shortcut.
    root=r.ROOT;old_name=root.name if root else None
    if root:root.name='_rounded_build'
    o=original_box(n,p,s,k,max(b,.0015),max(2,segments),sub)
    if root:root.name=old_name
    return o


def stroke(n,pts,radius=.006,color='wood'):
    return r.tube(n,pts,radius,color,2,1)


def grain(x,y,z,width=.5,vertical=False):
    # Inlaid cocoa grooves sit just inside the surface, with a lighter lip.
    for j in (-1,1):
        pts=[(x+(j*.035 if vertical else u),y+(u if vertical else j*.028)+.003*math.sin(i*2),z)
             for i,u in enumerate((-width/2,-width/4,0,width/4,width/2))]
        stroke('Carved wood grain',pts,.0035,'wood')


def bunny_details():
    r.BONE='body'
    # Separate cream stitch dashes follow the pocket, bib and skirt edge.
    for x in (-.065,-.039,-.013,.013,.039,.065):
        for y in (.334,.425):stroke('Pocket saddle stitch',[(x-.006,y,.218),(x+.006,y,.218)],.0028,'cream')
    for side in (-1,1):
        for y in (.35,.375,.40):stroke('Pocket side stitch',[(side*.070,y-.006,.218),(side*.070,y+.006,.218)],.0028,'cream')
        for y in (.54,.57,.60,.63):stroke('Bib edge stitch',[(side*.095,y-.006,.191),(side*.095,y+.006,.191)],.0028,'score')
    for i in range(13):
        x=-.17+i*.028
        stroke('Apron hem stitch',[(x-.006,.248,.188),(x+.006,.248,.188)],.0028,'score')
    r.BONE='head'
    for side in (-1,1):
        r.ball('Eye soft catchlight',(side*.142-.006,.984,.186),(.005,.006,.003),'cream',8,6)
        for j in range(3):r.ball('Cheek dimple',(side*(.208+j*.020),.913+(j%2)*.009,.177),(.0035,.0035,.0018),'rose',8,4)
    # Thin, soft brow contours preserve the logo's dot-eye expression.
    for side in (-1,1):
        stroke('Toast brow contour',[(side*.12,1.016,.165),(side*.145,1.020,.165),(side*.166,1.014,.161)],.003,'crust')
        label='L' if side<0 else 'R';r.BONE='ear'+label
        stroke('Ear inner fold',[(side*.218,1.29,.049),(side*.228,1.40,.050),(side*.242,1.51,.044)],.0038,'rose')
        r.BONE='leg'+label
        for dx in (-.026,.026):stroke('Paw toe crease',[(side*.13+dx,.075,.210),(side*.13+dx,.098,.202),(side*.13+dx,.115,.185)],.0035,'crust')
        r.BONE='arm'+label
        stroke('Paw thumb fold',[(side*.285,.397,.080),(side*.276,.375,.099),(side*.265,.365,.103)],.0035,'crust')
    r.BONE=None


def prop_details(n):
    if n=='cart':
        for x in (-.48,0,.48):grain(x,.56,.422,.30,True)
        for x in (-.70,.70):
            for y in (.42,.68):r.disc('Cart brass nail',(x,y,.425),.012,.006,'bread',vertices=8)
    elif n=='flour':
        for x,y in ((-.25,.26),(.25,.26),(0,.69)):
            for dx in (-.09,-.045,0,.045,.09):stroke('Sack stitched mouth',[(x+dx-.006,y+.13,.205),(x+dx+.006,y+.145,.202)],.0035,'wood')
    elif n=='awning':
        for x in (-.55,0,.55):stroke('Canopy sewn edge',[(x-.06,1.17,.407),(x+.06,1.17,.407)],.0038,'kraft')
    elif n=='puddle':
        for rad in (.28,.46):
            pts=[(rad*math.cos(a),.022,.60*rad*math.sin(a)) for a in [i*math.pi/14 for i in range(15)]]
            stroke('Soft puddle ripple',pts,.0015,'glass')
    elif n=='ramp':
        for i in range(12):
            z=-.90+i*.163;y=(z+1)*.65
            for offset in (-.025,.025):
                stroke('Ramp incised grain',[(x,y+.034+offset*.65+.002*math.sin(j),z+offset) for j,x in enumerate((-.60,-.3,0,.3,.60))],.0035,'wood')
    elif n in ('van','truck'):
        for x in (-.30,-.15,0,.15,.30):box('Radiator inset',(x,.40,2.986),(.075,.032,.014),'wood',.009)
        for side in (-1,1):
            stroke('Windshield wiper',[(side*.13,.84,2.987),(side*.49,.88,2.987)],.010,'wood')
            for z in (-1.95,1.95):
                for a in (0,math.pi/2,math.pi,3*math.pi/2):
                    r.disc('Wheel hub stud',(side*.949,.245+.09*math.cos(a),z+.09*math.sin(a)),.013,.001,'wood','x',8)
    elif n in ('bread','breadwheel'):
        # Scoring already has recessed crust plus pale dough; tiny crust blisters
        # add tactile scale without changing the loaf envelope.
        for i in range(14):
            a=i*2.399
            if n=='bread':
                x=.14*math.cos(a);z=.075*math.sin(a);y=.13+.13*math.sqrt(max(0,1-(x/.225)**2-(z/.135)**2))
                r.ball('Baked crust blister',(x,y-.001,z),(.006,.003,.006),'score' if i%3==0 else 'crust',8,4)
            else:
                yy=.34*math.cos(a);z=.34*math.sin(a);x=.24*math.sqrt(1-(yy/.6)**2-(z/.6)**2)
                for side in (-1,1):r.ball('Wheel crust blister',(side*x,.6+yy,z),(.003,.009,.009),'score',8,4)
    elif n=='bag':
        for x in (-.12,.12):stroke('Paper gusset crease',[(x,.08,-.117),(x*.80,.25,-.119),(x,.40,-.118)],.003,'crust')
        stroke('Seal embossed wheat',[(-.02,.23,-.132),(0,.27,-.136),(.02,.29,-.132)],.003,'cream')
    elif n=='coffee':
        for i in range(16):
            a=i*math.tau/16
            stroke('Pressed sleeve rib',[(.113*math.cos(a),.115,.113*math.sin(a)),(.123*math.cos(a),.218,.123*math.sin(a))],.002,'crust')
    elif n=='lamp':
        for z in (-.145,.145):
            box('Lamp glass inset',(0,2.84,z),(.21,.32,.008),'glass',.003)
            stroke('Glass bevel reflection',[(-.075,2.73,z*1.04),(-.075,2.92,z*1.04),(-.055,2.96,z*1.04)],.004,'cream')
            box('Lantern crossbar',(0,2.82,z*1.05),(.28,.018,.018),'wood',.005)
    elif n=='tree':
        for side in (-1,1):stroke('Bark groove',[(side*.031,.55,.08),(side*.045,.91,.09),(side*.018,1.35,.06)],.004,'kraft')
        for i in range(16):
            a=i*2.399;x=.48*math.cos(a);y=1.85+(i%4)*.12
            r.ball('Individual clay leaf',(x,y,.40*math.sin(a)),(.075,.12,.045),'leaf',8,6)
    elif n=='bench':
        for y in (.72,.94):
            for x in (-.40,.40):grain(x,y,-.208,.55)
        for z in (-.18,0,.18):stroke('Seat wood grain',[(-.65,.522,z),(-.25,.524,z+.01),(.25,.524,z-.006),(.65,.522,z)],.0035,'wood')
    elif n=='pothole':
        for i in range(12):
            a=i*math.tau/12
            stroke('Chipped stone seam',[(.60*math.cos(a),.050,.60*math.sin(a)),(.65*math.cos(a+.025),.057,.65*math.sin(a+.025)),(.71*math.cos(a+.01),.052,.71*math.sin(a+.01))],.003,'soil')
    elif n=='shoes':
        for x in (-.20,.20):
            for side in (-1,1):
                for z in (-.15,-.10,-.05,0,.05,.10):stroke('Sneaker saddle stitch',[(x+side*.143,.16,z-.008),(x+side*.143,.16,z+.008)],.0028,'cream')
    elif n=='shield':
        for i in range(12):
            a=i*math.tau/12;r.ball('Rim molded bead',(.413*math.cos(a),.46+.413*math.sin(a),.079),(.008,.008,.006),'score',8,4)
        for side in (-1,1):stroke('Emblem omega smile',[(0,.402,.177),(side*.015,.390,.176),(side*.03,.401,.172)],.003,'wood')
    elif n=='signal':
        for x in (-.10,.10):r.disc('Mounting screw',(x,.052,0),.012,.004,'cream','y',12)
        for i in range(16):
            a=i*math.tau/16
            r.ball('Lens stipple',(.126*math.cos(a),.218,.126*math.sin(a)),(.004,.004,.004),'score',8,4)


def facade_details(n):
    idx=FACADES.index(n)
    # Rounded relief brick piers, alternate bonds and small patches of exposed
    # masonry. All remain within the original width and front projection.
    for side in (-1,1):
        for row in range(19):
            x=side*(2.76 if row%2 else 2.70)
            box('Hand laid corner brick',(x,.36+row*.32,2.015),(.40 if row%2 else .52,.25,.075),'sandstone' if (row+idx)%3 else 'warmstone',.025)
    for row in range(3):
        for col in range(3-row):box('Exposed plaster brick',(-1.45+col*.32+row*.14,2.95+row*.16,2.018),(.29,.13,.044),'warmstone',.02)
    for x in (-1.9,0,1.9):
        for y in (4.15,5.6):
            # Slim open shutters fit between the existing bays.
            for side in (-1,1):
                xx=x+side*.73
                box('Shutter recessed leaf',(xx,y,2.085),(.25,1.10,.08),'wood',.022)
                for j in range(7):box('Shutter louver',(xx,y-.43+j*.14,2.14),(.23,.085,.07),'sage' if idx%2 else 'rose',.016)
                for yy in (-.34,.34):r.disc('Shutter hinge',(xx,y+yy,2.182),.025,.009,'bread',vertices=8)
    # Six complete tile courses bridge the prior isolated eave strips.
    for row in range(6):
        for col in range(15):
            x=-2.8+col*.4;z=-1.48+row*.59
            if n=='corner_house' and x>1.05 and z>.75:continue
            r.ball('Overlapping roof tile',(x,6.89+(row%2)*.006,z),(.196,.095,.34),'roof' if (col+row)%4 else 'rose',8,5)
    # Door panel molding and keyhole escutcheon.
    for x in (-.33,.33):box('Door panel molding',(x,.55,2.23),(.023,.39,.025),'score',.008)
    for y in (.36,.74):box('Door panel molding',(0,y,2.23),(.68,.023,.025),'score',.008)
    r.disc('Knob escutcheon',(.35,1.03,2.228),.067,.014,'crust',vertices=16)
    r.ball('Door keyhole',(.35,.925,2.235),(.009,.016,.004),'dark',8,4)
    # Wall-mounted lantern on every facade; opaque tinted glass avoids sorting.
    box('Wall lantern bracket',(1.0,2.45,2.25),(.05,.05,.32),'wood',.014)
    box('Wall lamp glass',(1.0,2.24,2.38),(.20,.30,.18),'glass',.028)
    for x in (.89,1.11):box('Wall lamp frame',(x,2.24,2.48),(.023,.34,.025),'wood',.006)
    for y in (2.07,2.41):box('Wall lamp cap',(1.0,y,2.38),(.27,.05,.25),'wood',.016)
    # More dimensional petals and stems in the existing window boxes.
    for x in (-1.9,1.9):
        for dx in (-.19,.02,.23):
            stroke('Window flower stem',[(x+dx,3.61,2.24),(x+dx-.02,3.84,2.28)],.009,'leaf')
            r.flower((x+dx,3.87,2.34),.65,'rose' if idx%2 else 'score',8)
    if n=='patisserie':
        for x in (-1.95,1.95):
            r.disc('Cake stand',(x,.79,2.20),.40,.05,'cream','y',24)
            r.disc('Layer cake',(x,.99,2.25),.29,.33,'rose','y',24)
            r.disc('Cake icing',(x,1.16,2.25),.30,.045,'cream','y',24)
            for i in range(7):r.ball('Piped cream rosette',(x+.22*math.cos(i*math.tau/7),1.20,2.25+.22*math.sin(i*math.tau/7)),(.040,.045,.040),'cream',10,6)
        r.disc('Patisserie cake icon',(0,3.05,2.31),.15,.055,'rose',vertices=24)
        for x in (-.09,0,.09):r.ball('Cake icon piped icing',(x,3.16,2.33),(.04,.025,.02),'cream',10,6)
    elif n=='cheese_shop':
        for x in (-1.95,1.95):
            r.disc('Cheese wheel',(x,.95,2.26),.33,.34,'bread','y',24)
            r.disc('Cheese rind',(x,1.13,2.26),.33,.025,'score','y',24)
            for dx in (-.17,0,.17):r.ball('Cheese eye',(x+dx,.97,2.56),(.035,.03,.009),'crust',10,6)
        r.profile('Cheese wedge icon',(0,3.05,2.32),(.42,.25,.10),'bread',[(-.5,-.5),(.5,-.5),(-.4,.5)],1)
        for x in (-.11,.02):r.disc('Cheese icon eye',(x,3.02,2.38),.027,.006,'crust',vertices=10)
    elif n=='tea_house':
        for x in (-1.95,1.95):
            r.ball('Tea pot',(x,1.01,2.30),(.22,.21,.18),'sage',20,12)
            r.disc('Tea lid',(x,1.205,2.30),.15,.03,'cream','y',20)
            r.ball('Tea lid knob',(x,1.24,2.30),(.045,.04,.045),'wood',12,8)
            stroke('Teapot spout',[(x+.14,1.00,2.30),(x+.29,1.08,2.30),(x+.32,1.17,2.30)],.045,'sage')
            m.ring('Teapot handle',(x-.21,1.05,2.30),.12,.025,'wood',segments=20)
        r.ball('Teapot shop emblem',(0,3.04,2.33),(.15,.12,.05),'sage',16,10)
        stroke('Teapot emblem spout',[(.11,3.02,2.33),(.22,3.11,2.33)],.03,'sage')
        m.ring('Teapot emblem handle',(-.15,3.06,2.33),.07,.018,'wood',segments=16)
    elif n=='corner_house':
        # Front corner bay/turret uses the same 6 x 7 m maximum envelope.
        r.lathe('Rounded corner turret',(2.02,0,1.76),[(4.72,.64),(4.80,.68),(5.85,.68),(5.95,.73),(6.02,.73)],'plaster',32)
        r.lathe('Turret conical tiled roof',(2.02,0,1.76),[(6.0,.80),(6.08,.80),(6.94,.06),(6.99,0)],'roof',32)
        for row in range(5):
            y=6.10+row*.16;rad=.76-row*.138
            r.lathe('Turret tile course',(2.02,0,1.76),[(y,rad),(y+.025,rad+.016),(y+.05,rad-.02)],'rose',32)
        box('Turret arched window recess',(2.02,5.40,2.444),(.48,.65,.038),'wood',.018)
        box('Turret glazing',(2.02,5.40,2.469),(.37,.54,.025),'glass',.012)
        box('Turret mullion',(2.02,5.40,2.487),(.035,.54,.023),'cream',.01)
    elif n=='cafe':
        for x in (-1.95,1.95):r.disc('Cafe display saucer',(x,.81,2.29),.30,.04,'cream','y',20);box('Cafe display cup',(x,.98,2.29),(.28,.28,.24),'wood',.065)
    elif n=='flower_shop':
        for x in (-1.95,1.95):r.planter((x,.75,2.25),.85,True)


def cobble(x,z,k,width=.478):
    # Rounded low domes with 4–12 mm periodic height variation. The tile boundary
    # and lane paint height remain exactly as authored in the renderer contract.
    h=.008+.004*(.5+.5*math.sin(x*12.7+z*9.3))
    outline=[];radius=min(.065,width*.24)
    for cx,cz,start in ((width/2-radius,.239-radius,0),(-width/2+radius,.239-radius,90),
                        (-width/2+radius,-.239+radius,180),(width/2-radius,-.239+radius,270)):
        for i in range(4):
            a=math.radians(start+i*30)
            outline.append((cx+radius*math.cos(a),cz+radius*math.sin(a)))
    verts=[];faces=[];N=len(outline)
    # Wide plan-view corner radii are independent of the shallow 12 mm height.
    # Four shoulder rings round the side/top profile without square box corners.
    for y,scale in ((0,.97),(h*.35,1),(h*.78,.985),(h,.93)):
        verts.extend(r.xyz((x+xx*scale,y,z+zz*scale)) for xx,zz in outline)
    faces.append(tuple(reversed(range(N))))
    for row in range(3):
        for i in range(N):faces.append((row*N+i,row*N+(i+1)%N,(row+1)*N+(i+1)%N,(row+1)*N+i))
    faces.append(tuple(range(3*N,4*N)))
    me=bpy.data.meshes.new('Rounded pillow cobble');me.from_pydata(verts,[],faces);me.update()
    o=bpy.data.objects.new('Rounded pillow cobble',me);bpy.context.collection.objects.link(o)
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
    return r.finish(o,k)


def ao(o):
    me=o.data;me.update();colors=me.color_attributes['ClayColor']
    tree=BVHTree.FromPolygons([v.co for v in me.vertices],[list(p.vertices) for p in me.polygons],all_triangles=False,epsilon=0)
    # Deterministic local hemisphere probes provide actual contact/recess AO.
    for v,c in zip(me.vertices,colors.data):
        normal=v.normal.normalized()
        if normal.length<.1:continue
        tangent=normal.cross(Vector((0,0,1)) if abs(normal.z)<.9 else Vector((1,0,0))).normalized()
        bitangent=normal.cross(tangent)
        origin=v.co+normal*.0012;occlusion=0
        for dx,dy in ((0,0),(.7,0),(-.7,0),(0,.7),(0,-.7)):
            direction=(normal+tangent*dx+bitangent*dy).normalized()
            hit=tree.ray_cast(origin,direction,.15)
            if hit[0] is not None:occlusion+=1-hit[3]/.15
        shade=1-.19*occlusion/5
        c.color=(*(max(0,x*shade) for x in c.color[:3]),1)


def joined(n):
    root=r.ROOT.name if r.ROOT else n
    if n=='BunnyClay':bunny_details()
    elif root in FACADES:facade_details(root)
    elif root=='sidewalk':
        for x in (-.96,.96):
            for z in (-2.5,-1.5,-.5,.5,1.5,2.5):
                box('Curb stone top bevel',(x,.174,z),(.075,.012,.95),'warmstone',.005)
                for zz in (-.30,.30):stroke('Curb weathered indent',[(x-.022,.18,z+zz),(x+.018,.18,z+zz+.014)],.002,'soil')
    elif root not in NEW_PROPS:prop_details(root)
    o=original_join(n)
    if root in NEW_PROPS and root!='bunting':
        ground=min(v.co.z for v in o.data.vertices)
        for v in o.data.vertices:v.co.z-=ground
    # Keep the published prop triangle band, retaining curves and tiny detail.
    tris=sum(len(p.vertices)-2 for p in o.data.polygons)
    if root not in FACADES+['bunny','sidewalk','road'] and tris>7900:
        mod=o.modifiers.new('Preserve 8k prop ceiling','DECIMATE');mod.ratio=7850/tris
        r.apply(o,mod)
    ao(o)
    tris=sum(len(p.vertices)-2 for p in o.data.polygons)
    inventory[root]={'triangles':tris,'vertices':len(o.data.vertices),'aoProbeCount':5}
    print('REFINED',root,tris,flush=True)
    return o


def new_props():
    r.clear();r.group('planter');r.planter(s=1.2,flowers=True)
    for x in (-.30,0,.30):
        stroke('Planter tall stem',[(x,.41,0),(x+.03,.67,.015)],.012,'leaf')
        r.flower((x+.03,.70,.04),.8,'rose',10)
        r.ball('Planter individual leaf',(x-.04,.56,.02),(.10,.035,.045),'sage',10,6)
    joined('planterMesh')
    r.group('bicycle')
    # Wheels lie in the YZ plane; front wheel and handlebars point +Z.
    for z in (-.57,.57):
        m.ring('Rounded bicycle tire',(0,.35,z),.33,.035,'wood','x',48)
        m.ring('Cream wheel rim',(0,.35,z),.29,.012,'cream','x',40)
        r.disc('Bicycle hub',(0,.35,z),.06,.15,'bread','x',16)
        for i in range(12):
            a=i*math.tau/12
            stroke('Bicycle spoke',[(0,.35,z),(0,.35+.285*math.cos(a),z+.285*math.sin(a))],.005,'kraft')
    for points in [[(0,.35,-.57),(0,.40,-.04),(0,.85,-.22),(0,.35,-.57)],[(0,.40,-.04),(0,.85,.38),(0,.85,-.22)],[(0,.85,.38),(0,.35,.57)],[(0,.85,-.22),(0,.98,-.25)]]:
        stroke('Rounded bicycle frame',points,.028,'sage')
    box('Leather bicycle saddle',(0,1.0,-.27),(.25,.07,.29),'wood',.035)
    stroke('Handlebar stem',[(0,.77,.39),(0,1.10,.34)],.025,'wood')
    stroke('Curved handlebars',[(-.26,1.06,.26),(-.24,1.12,.36),(0,1.13,.37),(.24,1.12,.36),(.26,1.06,.26)],.023,'wood')
    for x in (-.26,.26):stroke('Leather grips',[(x,1.07,.26),(x,1.02,.18)],.031,'kraft')
    box('Front wicker basket',(0,.92,.68),(.42,.28,.32),'kraft',.035)
    box('Basket dark opening',(0,1.064,.68),(.34,.012,.24),'soil',.02)
    for i in range(5):box('Basket woven band',(0,.82+i*.047,.846),(.40,.012,.009),'score',.004)
    for x in (-.16,-.08,0,.08,.16):stroke('Basket upright weave',[(x,.80,.846),(x,1.04,.846)],.005,'wood')
    for side in (-1,1):
        box('Bicycle pedal',(side*.17,.40,-.04),(.14,.045,.10),'wood',.018)
        stroke('Pedal crank',[(0,.40,-.04),(side*.17,.40,-.04)],.015,'bread')
    stroke('Bicycle kickstand',[(.04,.42,-.13),(.21,.015,-.25)],.015,'wood')
    joined('bicycleMesh')
    r.group('crate_stack')
    for x,y,z in ((-.27,0,0),(.30,0,.08),(-.12,.43,.025)):
        for yy in (.10,.25,.39):
            for zz in (-.22,.22):
                box('Crate rounded slat',(x,y+yy,z+zz),(.52,.11,.045),'kraft',.012)
                grain(x,y+yy,z+zz+(.024 if zz>0 else -.024),.35)
            for xx in (-.25,.25):box('Crate side slat',(x+xx,y+yy,z),(.045,.11,.42),'kraft',.012)
        for xx in (-.23,.23):
            for zz in (-.20,.20):box('Crate corner batten',(x+xx,y+.22,z+zz),(.055,.43,.055),'wood',.012)
        for xx in (-.24,.24):
            for yy in (.10,.39):r.disc('Crate peg',(x+xx,y+yy,z+.247),.012,.006,'cream',vertices=8)
    for x in (-.23,.04):r.loaf((x,.92,.02),.6,16)
    joined('crate_stackMesh')
    r.group('menu_board')
    for side in (-1,1):
        for x in (-.29,.29):stroke('A frame rounded leg',[(x,.025,side*.29),(x,1.02,0)],.035,'kraft')
        o=box('Blank cocoa menu inset',(0,.61,side*.15),(.52,.65,.045),'dark',.02);o.rotation_euler.x=side*.20
        for x in (-.30,.30):stroke('Menu wood side frame',[(x,.25,side*.23),(x,.97,side*.06)],.027,'kraft')
        for y,z in ((.27,.23),(.96,.065)):box('Menu horizontal rail',(0,y,side*z),(.65,.06,.065),'kraft',.022)
        for x in (-.29,.29):r.disc('Menu hinge peg',(x,1.01,0),.028,.075,'bread','x',12)
    for x in (-.29,.29):stroke('Menu frame stay',[(x,.34,-.19),(x,.34,.19)],.010,'wood')
    for side in (-1,1):
        for y,z in ((.27,.265),(.96,.100)):grain(0,y,side*z,.47)
        for x in (-.29,.29):
            for y,z in ((.27,.265),(.96,.100)):r.disc('Menu frame brass peg',(x,y,side*z),.012,.008,'bread',vertices=10)
    joined('menu_boardMesh')
    r.group('bunting');r.ROOT['anchor']='midpoint between attachment ends';r.ROOT['attachmentEnds']=[-4,0,0,4,0,0]
    # Local Y=0 is the attachment line; renderer places this anchor above street.
    pts=[(x,-.42*(1-(x/4)**2),0) for x in (-4,-3,-2,-1,0,1,2,3,4)]
    stroke('Bunting suspension cord',pts,.014,'wood')
    for i in range(13):
        x=-3.6+i*.6;y=-.42*(1-(x/4)**2)
        r.profile('Molded little bunting flag',(x,y-.16,.006),(.38,.33,.025),['rose','cream','sage','score'][i%4],[(-.5,.5),(.5,.5),(.08,-.5)],1)
        stroke('Flag stitched header',[(x-.15,y-.008,.023),(x+.15,y-.008,.023)],.004,'kraft')
        for side in (-1,1):stroke('Flag sewn side',[(x+side*.14,y-.045,.022),(x+side*.08,y-.16,.022),(x+.02,y-.27,.022)],.003,'kraft')
    joined('buntingMesh');original_export('scatter')


def build():
    for stale in (r.OUT/'facades').glob('*.glb'):stale.unlink()
    r.finish=finish;r.box=box;r.joined=joined;r.cobble=cobble
    r.bunny();r.props();m.build();new_props();r.town(FACADES)
    (HERE/'.cache/model-build.json').write_text(json.dumps(inventory,indent=2)+'\n')


if __name__=='__main__':
    if '--facade-only' in sys.argv or '--town-root' in sys.argv:
        flag='--town-root' if '--town-root' in sys.argv else '--facade-only'
        name=sys.argv[sys.argv.index(flag)+1];assert name in FACADES+['road','sidewalk']
        r.OUT=r.OUT/'facades';r.OUT.mkdir(parents=True,exist_ok=True)
        def single_export(_):
            root=bpy.data.objects[name]
            for o in list(bpy.context.scene.objects):
                if o!=root and o.parent!=root:bpy.data.objects.remove(o,do_unlink=True)
            original_export(name)
        r.finish=finish;r.box=box;r.joined=joined;r.cobble=cobble;r.export=single_export
        r.town([name] if name in FACADES else [])
    elif '--bunny-only' in sys.argv:
        r.finish=finish;r.box=box;r.joined=joined;r.bunny()
    elif '--scatter-only' in sys.argv:
        r.finish=finish;r.box=box;r.joined=joined;new_props()
    else:build()

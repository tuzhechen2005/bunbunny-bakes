"""R15 additive props. Uses the original clay authoring helpers; no old mesh rebuild."""
import sys, math, os
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import render as r
import bpy
from mathutils import Vector

def ring(n,p,radius,thickness,color,axis='z',segments=40):
    x,y,z=p
    pts=[]
    for i in range(segments+1):
        a=i*math.tau/segments
        pts.append((x,y+radius*math.cos(a),z+radius*math.sin(a)) if axis=='x' else (x+radius*math.cos(a),y+radius*math.sin(a),z))
    r.tube(n,pts,thickness,color,1,2)

def build():
    r.clear();r.P.update(amber='EBA43B',honey='F9CC70',pit='372E29')
    r.group('pothole')
    r.disc('Dark inset floor',(0,.008,0),.72,.016,'pit','y',48)
    # Broken wedge-shaped cobbles: a circular opening, chipped radial inner edges.
    for i in range(16):
        a=i*math.tau/16; vs=[]
        for y in (.012,.062):
            for rad,off in ((.57,-.15),(.78,-.17),(.80,0),(.78,.17),(.58,.15),(.54,.035)):
                vs.append(r.xyz((rad*math.cos(a+off),y,rad*math.sin(a+off))))
        faces=[tuple(reversed(range(6))),tuple(range(6,12))]+[(j,(j+1)%6,(j+1)%6+6,j+6) for j in range(6)]
        me=bpy.data.meshes.new('Broken cobble');me.from_pydata(vs,[],faces);me.update()
        o=bpy.data.objects.new('Broken cobble',me);bpy.context.collection.objects.link(o)
        bpy.context.view_layer.objects.active=o
        mod=o.modifiers.new('Soft chipped edges','BEVEL');mod.width=.012;mod.segments=1+i%2;r.apply(o,mod)
        r.finish(o,['stone','cobble','warmstone'][i%3])
    r.joined('potholeMesh')
    r.group('breadwheel')
    r.ball('Round baked wheel',(0,.6,0),(.24,.6,.6),'bread',24,18)
    for side in (-1,1):
        # Ellipsoid's face is X; wheel travels along +Z and rotates around X.
        ring('Baked crust edge',(side*.17,.6,0),.40,.018,'crust','x',32)
        for z0 in (-.23,0,.23):
            pts=[]
            for j in range(9):
                y=-.32+j*.08;z=z0+.12*y
                x=side*(.24*math.sqrt(max(.05,1-(y/.6)**2-(z/.6)**2))+.002)
                pts.append((x,.6+y,z))
            r.tube('Deep scoring',pts,.023,'crust',1,1)
            r.tube('Flour in split crust',[(x+side*.012,y,z) for x,y,z in pts],.012,'score',1,1)
    r.joined('breadwheelMesh')
    r.group('shoes')
    for x in (-.20,.20):
        r.box('Bouncy outsole',(x,.055,.015),(.31,.11,.63),'cream',.055,4)
        r.ball('Clay sneaker upper',(x,.18,0),(.145,.15,.28),'rose',16,10)
        r.ball('Cream toe cap',(x,.13,.205),(.143,.075,.115),'cream',12,8)
        r.ball('Ankle collar',(x,.285,-.14),(.123,.045,.115),'cream',16,8)
        r.ball('Dark ankle opening',(x,.31,-.14),(.085,.012,.075),'dark',16,8)
        for z in (-.025,.035,.095):
            r.tube('Cream crossed lace',[(x-.085,.295,z-.025),(x,.342,z),(x+.085,.295,z+.025)],.012,'cream',2,2)
        for z in (-.21,-.1,.01,.12,.23):
            r.box('Sole flex groove',(x,.045,z),(.316,.012,.015),'kraft',.005,2)
        r.tube('Heel pull tab',[(x-.025,.26,-.23),(x,.35,-.25),(x+.025,.26,-.23)],.015,'sage',3,2)
    r.joined('shoesMesh')
    r.group('shield')
    r.ball('Solid clay bubble',(0,.46,0),(.46,.46,.14),'glass',24,16)
    ring('Cream protective rim',(0,.46,.065),.415,.025,'cream',segments=40)
    r.ball('Bunny medallion head',(0,.43,.142),(.145,.12,.025),'cream',16,10)
    for x in (-.07,.07):
        r.ball('Bunny emblem ear',(x,.61,.133),(.045,.13,.024),'cream',12,8)
        r.ball('Pink ear inset',(x,.62,.155),(.021,.085,.01),'pink',12,8)
    for x in (-.049,.049):r.ball('Emblem eye',(x,.45,.17),(.012,.017,.008),'dark',12,8)
    r.ball('Bunny nose',(0,.414,.173),(.017,.012,.009),'rose',12,8)
    r.tube('Bubble glint',[(-.30,.58,.10),(-.27,.67,.11),(-.20,.73,.11)],.017,'cream',3,2)
    r.joined('shieldMesh')
    r.group('signal')
    r.disc('Roof mounting foot',(0,.025,0),.17,.05,'dark','y',40)
    r.disc('Cream beacon collar',(0,.062,0),.155,.035,'cream','y',40)
    r.lathe('Amber molded dome',(0,0,0),[(.075,.14),(.10,.14),(.20,.13),(.25,.11),(.28,.07),(.29,0)],'amber',48)
    for i in range(12):
        a=i*math.tau/12
        r.tube('Lens molded rib',[(.141*math.cos(a),.09,.141*math.sin(a)),(.134*math.cos(a),.19,.134*math.sin(a)),(.112*math.cos(a),.247,.112*math.sin(a))],.006,'honey',2,2)
    r.joined('signalMesh');r.export('mechanics')

def preview():
    r.clear();lib=r.import_library('props')
    for name,p,yaw in [('pothole',(-1.1,0,.85),0),('breadwheel',(-1.05,0,-.9),0),('shoes',(.35,0,.85),0),('shield',(.6,0,-.8),0),('signal',(1.4,0,.75),0)]:r.instance(lib[name],p,yaw)
    r.box('Studio floor',(0,-.065,0),(200,.1,200),'cream',0)
    r.light_scene(True);r.camera((2.6,4,7),(0,.3,0),56)
    s=bpy.context.scene;s.render.resolution_x=512;s.render.resolution_y=384
    s.render.filepath=str(Path(__file__).resolve().parent/'mechanics-preview.png');bpy.ops.render.render(write_still=True)

if __name__=='__main__':
    if '--preview' in sys.argv:preview()
    else:build()

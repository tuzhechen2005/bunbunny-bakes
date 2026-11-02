"""R17 deterministic asset-only rebuild: porous foliage, wet clay water, sewn canvas.
Run with Blender 4.3.2. No textures, external models, or application changes.
"""
import sys, math, random, os
from pathlib import Path
import bpy
from mathutils import Vector
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
os.environ['RUN3D_OUT']=str(HERE/'.cache/raw')
import refine as f
r=f.r
r.P.update({'olive':'70865C','sageLight':'B8C99B','sageMid':'93AC80',
            'blossom':'E9C1C5','blossomLight':'F7E0DA','wet':'666F66','water':'235E70'})
r.finish=f.finish;r.box=f.box;r.cobble=f.cobble


def mesh(name,vs,faces,color):
    data=bpy.data.meshes.new(name);data.from_pydata([r.xyz(v) for v in vs],[],faces);data.update()
    o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o)
    return r.finish(o,color)


def leaf(p,size,color,angle=0,tilt=0):
    # Closed clay petal: six sides, rounded shoulders, pinched ends, curved ridge.
    vs=[];faces=[];N=6
    for j in range(4):
        t=j/3;w=max(.025,math.sin(math.pi*t))
        for i in range(N):
            a=i*math.tau/N
            vs.append((size[0]*w*math.cos(a),size[1]*(2*t-1),size[2]*w*math.sin(a)+size[2]*.5*math.sin(math.pi*t)))
    for j in range(3):
        for i in range(N):faces.append((j*N+i,j*N+(i+1)%N,(j+1)*N+(i+1)%N,(j+1)*N+i))
    faces.extend([tuple(reversed(range(N))),tuple(range(3*N,4*N))])
    o=mesh('Individually pressed clay leaf',vs,faces,color);o.location=r.xyz(p)
    o.rotation_euler=(tilt,angle,0)
    return o


def bloom(p,s=1,seed=0):
    x,y,z=p
    for i in range(5):
        a=i*math.tau/5
        o=r.ball('Five petal blossom',(x+.038*s*math.sin(a),y+.038*s*math.cos(a),z),(.029*s,.037*s,.018*s),'blossomLight' if (i+seed)%3 else 'blossom',6,4)
        o.rotation_euler.y=-a
    r.ball('Blossom pollen',(x,y,z+.019*s),(.014*s,.014*s,.011*s),'score',6,4)


def tree(kind):
    rng=random.Random(170+['tree','tree_round2','tree_tall'].index(kind))
    r.lathe('Wheel thrown tree pot',(0,0,0),[(0,.28),(.04,.30),(.39,.39),(.43,.42),(.47,.42),(.49,.36),(.46,.34)],'roof',24)
    r.disc('Tree soil',(0,.465,0),.35,.02,'soil','y',24)
    # Flared buttress roots meet the soil; tapering twisted trunk has bark flutes.
    for i in range(5):
        a=i*math.tau/5
        r.tube('Exposed root',[(.30*math.cos(a),.477,.30*math.sin(a)),(.15*math.cos(a+.15),.49,.15*math.sin(a+.15)),(.045*math.cos(a),.67,.045*math.sin(a))],.025,'wood',3,1)
    vs=[];faces=[];N=12
    for j in range(10):
        y=.47+j*.135;rad=.095-j*.006
        for i in range(N):
            a=i*math.tau/N;rr=rad*(1+.12*math.sin(i*2.6+j*.7))
            vs.append((.035*math.sin(j*.65)+rr*math.cos(a),y,.02*math.sin(j*.8)+rr*math.sin(a)))
    for j in range(9):
        for i in range(N):faces.append((j*N+i,j*N+(i+1)%N,(j+1)*N+(i+1)%N,(j+1)*N+i))
    mesh('Sculpted fluted trunk',vs,faces,'wood')
    for i in range(7):
        a=i*math.tau/7
        r.tube('Bark raised grain',[(.035*math.sin(j*.65)+(.096-j*.006)*math.cos(a+j*.035),.47+j*.135,.02*math.sin(j*.8)+(.096-j*.006)*math.sin(a+j*.035)) for j in range(9)],.003,'kraft',1,0)
    if kind=='tree_tall':
        clusters=[(-.15,1.25,0,.31),(.13,1.55,-.04,.31),(-.08,1.83,.04,.27),(.04,2.10,0,.23),(0,2.38,0,.15)]
    else:
        clusters=[(-.40,1.65,-.06,.37),(.40,1.82,-.03,.39),(-.06,2.28,.02,.38),(-.05,1.83,-.34,.34),(.02,1.91,.31,.35)]
    for ci,(x,y,z,rad) in enumerate(clusters):
        r.tube('Visible canopy fork',[(.02,1.05,0),(.02+x*.5,1.34,z*.40),(x,y,z)],.030 if ci<2 else .023,'wood',3,1)
        # Leaves spiral over separate clumps, with no underlying sphere to fill gaps.
        count=15 if kind=='tree_round2' else 18
        for j in range(count):
            v=1-2*(j+.5)/count;a=j*2.39996+ci*.7
            q=math.sqrt(1-v*v)
            p=(x+rad*.78*q*math.cos(a),y+rad*.78*v,z+rad*.65*q*math.sin(a))
            sz=(rad*.39,rad*.48,rad*.29) if kind!='tree_tall' else (rad*.34,rad*.64,rad*.29)
            o=r.ball('Rounded individual clay leaf',p,sz,['olive','sageMid','sageLight','leaf','sageMid'][j%5],8,5)
            o.rotation_euler=(rng.uniform(-.45,.45),rng.uniform(-1.1,1.1),0)
        if kind=='tree_round2':
            for j in range(1):
                bloom((x+(-.13 if j else .10),y+(.08 if j else -.10),z+rad*.72),1.15,ci+j)
    r.ROOT['foliageClumps']=5;r.ROOT['foliageConstruction']='Individual rounded clay leaves; no solid canopy core'
    r.ROOT['variant']=kind


def planter(p=(0,0,0),s=1,flowers=True):
    x,y,z=p
    r.box('Terracotta planter',(x,y+.16*s,z),(.80*s,.32*s,.35*s),'roof',.045*s,3)
    r.box('Planter rim',(x,y+.31*s,z),(.85*s,.07*s,.40*s),'rose',.025*s,3)
    r.box('Soil',(x,y+.341*s,z),(.73*s,.015*s,.29*s),'soil',.005*s,2)
    for i in range(3):
        xx=x+(i-1)*.24*s;yy=y+(.55+.05*(i%2))*s
        f.stroke('Flower branching stem',[(xx,y+.34*s,z),(xx-.018*s,yy,z+.015*s)],.009*s,'olive')
        for j in range(5):
            a=j*2.399+i
            leaf((xx+.063*s*math.cos(a),y+(.39+.028*j)*s,z+.055*s*math.sin(a)),(.044*s,.096*s,.021*s),['sageMid','olive','sageLight'][j%3],a,.4*math.sin(a))
        if flowers:bloom((xx-.018*s,yy+.035*s,z+.06*s),.94*s,i)
    for i in range(10):
        r.ball('Soil granule',(x+(-.30+i*.065)*s,y+.353*s,z+.105*s*math.sin(i*2.4)),(.013*s,.006*s,.009*s),'kraft',6,4)


def awning(width=1.8,height=1.1,depth=.8,color='rose',posts=True,z=0,architectural=False):
    if posts:
        for x in (-width/2+.045,width/2-.045):
            r.box('Turned canopy post',(x,(height+.24)/2,z),(.075,height+.24,.075),'wood',.03)
            r.disc('Post finial',(x,height+.255,z),.055,.08,'bread','y',16)
    for i in range(8):
        w=width/8;cx=-width/2+(i+.5)*w;k='cream' if i%2 else color
        vs=[];faces=[];nx=4;ny=8
        def ysurf(u,v):return height+.20-.12*(v-.5)*depth-.022*math.sin(math.pi*v)+.012*math.cos(u*math.tau*2)*math.sin(math.pi*v)
        for layer in range(2):
            for b in range(ny+1):
                v=b/ny
                for a in range(nx+1):
                    u=a/nx;vs.append((cx+(u-.5)*w,ysurf(u,v)-layer*.035,z+(v-.5)*depth))
        off=(nx+1)*(ny+1)
        for b in range(ny):
            for a in range(nx):
                q=b*(nx+1)+a
                faces.extend([(q,q+1,q+nx+2,q+nx+1),(off+q+nx+1,off+q+nx+2,off+q+1,off+q)])
        boundary=list(range(nx+1))+[b*(nx+1)+nx for b in range(1,ny+1)]+[ny*(nx+1)+a for a in range(nx-1,-1,-1)]+[b*(nx+1) for b in range(ny-1,0,-1)]
        for a,b in zip(boundary,boundary[1:]+boundary[:1]):faces.append((a,off+a,off+b,b))
        mesh('Sagged and folded canvas panel',vs,faces,k)
        r.profile('Round scalloped valance',(cx,height+.055,z+depth/2-.025),(w,.17,.045),k,[(-.5,.5),(.5,.5)]+[(.5*math.cos(a*math.pi/8),-.5*math.sin(a*math.pi/8)) for a in range(9)],0)
        for side in (-1,1):
            pts=[]
            for j in range(9):
                v=j/8;u=.03 if side<0 else .97
                pts.append((cx+(u-.5)*w,ysurf(u,v)+.002,z+(v-.5)*depth))
            f.stroke('Raised stitched panel seam',pts,.0026,'kraft' if k=='cream' else 'cream')
        for j in range(4):
            u=(j+.5)/4;x=cx+(u-.5)*w
            f.stroke('Valance saddle stitch',[(x-.009,height+.10,z+depth/2),(x+.009,height+.10,z+depth/2)],.0026,'kraft' if k=='cream' else 'cream')


def puddle(segments=96,rings=36):
    N=segments;R=rings
    outline=[]
    for i in range(N):
        a=i*math.tau/N;w=1+.065*math.sin(3*a+.5)+.043*math.cos(5*a-.7)+.022*math.sin(9*a)
        outline.append((w*math.cos(a),w*math.sin(a)))
    # The outside wet boundary is exactly 1.7 x 1.1 metres, centered on its anchor.
    for axis,size in ((0,1.7),(1,1.1)):
        lo=min(p[axis] for p in outline);hi=max(p[axis] for p in outline)
        outline=[tuple((v-(hi+lo)/2)*size/(hi-lo) if k==axis else v for k,v in enumerate(p)) for p in outline]
    vs=[(0,.005,0)];faces=[]
    def height(t):
        return .005+.011*t*t+sum(.0035*math.exp(-((t-c)/.025)**2) for c in (.28,.51,.74))
    for j in range(1,R+1):
        t=j/R
        for x,z in outline:vs.append((x*.94*t,height(t),z*.94*t))
    for i in range(N):faces.append((0,1+(i+1)%N,1+i))
    for j in range(R-1):
        for i in range(N):
            a=1+j*N+i;b=1+j*N+(i+1)%N
            faces.append((a,b,b+N,a+N))
    water=mesh('Concave water with three concentric ripple ridges',vs,faces,'water')
    colors=water.data.color_attributes['ClayColor'];deep=[r.linear(v/255) for v in (22,75,94)];edge=[r.linear(v/255) for v in (112,174,174)]
    for i,c in enumerate(colors.data):
        t=0 if i==0 else ((i-1)//N+1)/R;mix=t**2.2
        ridge=sum(math.exp(-((t-v)/.026)**2) for v in (.28,.51,.74))
        c.color=(*(deep[k]*(1-mix)+edge[k]*mix+.018*ridge for k in range(3)),1)
    mat=water.data.materials[0];bsdf=mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value=.05;bsdf.inputs['Metallic'].default_value=.15;bsdf.inputs['Specular IOR Level'].default_value=.5
    vs=[];faces=[]
    for t,y in ((.935,.015),( .965,.010),(1,0)):
        vs.extend((x*t,y,z*t) for x,z in outline)
    for j in range(2):
        for i in range(N):faces.append((j*N+i,j*N+(i+1)%N,(j+1)*N+(i+1)%N,(j+1)*N+i))
    rim=mesh('Dark wet stain on surrounding stone',vs,faces,'wet')
    # Thin wet pigment follows the surface beneath it; small flattened edge stones.
    for i in (4,17,38,47,65,82,89):
        x,z=outline[round(i*N/96)%N]
        r.ball('Wet edge pebble',(x*.965,.012,z*.965),(.020,.012,.014),'wet' if i%2 else 'stone',8,4)
    r.ROOT['footprint']=[1.7,1.1];r.ROOT['rippleRadii']=[.28,.51,.74]
    r.ROOT['waterRoughness']=.05;r.ROOT['waterMetalness']=.15


def join_nature(n):
    root=r.ROOT.name
    if root in ('tree','puddle'):
        for o in r.PARTS:bpy.data.objects.remove(o,do_unlink=True)
        r.PARTS=[]
        tree(root) if root=='tree' else puddle()
    if root.startswith('tree') or root=='puddle':
        o=f.original_join(n)
        if root.startswith('tree'):
            if root!='tree_tall':
                # Match R16 placement/height/width envelope exactly.
                for axis,lo,hi in ((0,-.81,.83),(1,-.59,.72),(2,0,2.66)):
                    oldlo=min(v.co[axis] for v in o.data.vertices);oldhi=max(v.co[axis] for v in o.data.vertices)
                    for v in o.data.vertices:v.co[axis]=lo+(v.co[axis]-oldlo)*(hi-lo)/(oldhi-oldlo)
            f.ao(o)
        tris=sum(len(p.vertices)-2 for p in o.data.polygons)
        print('R17',root,tris,flush=True)
        assert tris<=8000,(root,tris)
        return o
    return f.joined(n)


def build():
    r.planter=planter;r.awning=awning;r.joined=join_nature
    r.export=lambda name:None
    r.props()
    keep={'tree','puddle','awning','cart'}
    for o in list(bpy.context.scene.objects):
        if o.name not in keep and (not o.parent or o.parent.name not in keep):bpy.data.objects.remove(o,do_unlink=True)
    for name in ('tree_round2','tree_tall'):
        r.group(name);tree(name);join_nature(name+'Mesh')
    r.group('planter');planter(s=1.2);f.joined('planterMesh')
    f.original_export('nature-props')
    if '--props-only' in sys.argv:return
    r.export=f.original_export
    r.town(f.FACADES)

if __name__=='__main__':build()

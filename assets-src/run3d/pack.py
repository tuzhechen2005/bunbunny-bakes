"""Plain glTF 2.0 packing; no extension or decoder. Keep float positions/normals.
Bake COLOR_0 into normalized RGBA8, rigid skin weights into normalized RGBA8,
and share identical binary streams. All meshes and animation samples retained.
"""
import json, struct
from pathlib import Path
BASE=Path(__file__).resolve().parents[2]/'public/brand/run3d'
SIZES={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4}
DIMS={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}

def pack(path):
    raw=path.read_bytes();length=struct.unpack_from('<I',raw,12)[0]
    g=json.loads(raw[20:20+length]);src=raw[28+length:];color=set();weight=set()
    for mesh in g['meshes']:
        for p in mesh['primitives']:
            color.add(p['attributes']['COLOR_0'])
            if 'WEIGHTS_0' in p['attributes']:weight.add(p['attributes']['WEIGHTS_0'])
    data=bytearray();views=[];seen={}
    for i,a in enumerate(g['accessors']):
        assert not a.get('sparse')
        v=g['bufferViews'][a['bufferView']];n=DIMS[a['type']];size=n*SIZES[a['componentType']]
        off=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',size)
        stream=b''.join(src[off+j*stride:off+j*stride+size] for j in range(a['count']))
        if (i in color or i in weight) and a['componentType']==5126:
            vals=struct.unpack('<'+'f'*(a['count']*n),stream);out=bytearray()
            for j in range(a['count']):
                row=[max(0,min(255,round(x*255))) for x in vals[j*n:(j+1)*n]]
                if i in color and n==3:row.append(255)
                if i in weight:
                    # Current rigid weights are exactly representable; don't silently distort skinning.
                    assert sum(row)==255
                out.extend(row)
            stream=bytes(out);a['componentType']=5121;a['normalized']=True;a['type']='VEC4'
            a.pop('min',None);a.pop('max',None)
        width=DIMS[a['type']]*SIZES[a['componentType']]
        key=(v.get('target'),width if v.get('target')==34962 else None,stream)
        if key not in seen:
            while len(data)%4:data.append(0)
            nv={'buffer':0,'byteOffset':len(data),'byteLength':len(stream)}
            if v.get('target'):nv['target']=v['target']
            if nv.get('target')==34962:
                width=DIMS[a['type']]*SIZES[a['componentType']]
                assert width%4==0
                nv['byteStride']=width
            seen[key]=len(views);views.append(nv);data.extend(stream)
        a['bufferView']=seen[key];a.pop('byteOffset',None)
    g['bufferViews']=views
    while len(data)%4:data.append(0)
    g['buffers']=[{'byteLength':len(data)}]
    meta=json.dumps(g,separators=(',',':')).encode();meta+=b' '*((-len(meta))%4)
    result=struct.pack('<III',0x46546c67,2,28+len(meta)+len(data))+struct.pack('<II',len(meta),0x4e4f534a)+meta+struct.pack('<II',len(data),0x004e4942)+data
    path.write_bytes(result);print(f'{path.name}: {len(raw):,} → {len(result):,} bytes (plain glTF)')

if __name__=='__main__':
    for name in ('bunny','props','town'):pack(BASE/(name+'.glb'))

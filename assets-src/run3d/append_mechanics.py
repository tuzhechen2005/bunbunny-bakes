"""Append packed R15 geometry while preserving every original JSON entry and byte."""
import json, struct, hashlib
from pathlib import Path
from pack import pack
HERE=Path(__file__).resolve().parent
BASE=HERE/'.cache/props-original.glb'
NEW=HERE/'.cache/mechanics.glb'
OUT=HERE.parents[1]/'public/brand/run3d/props.glb'
def read(p):
    b=p.read_bytes();n=struct.unpack_from('<I',b,12)[0]
    return json.loads(b[20:20+n]),b[28+n:]
def append():
    pack(NEW)
    g,b=read(BASE);n,d=read(NEW)
    new_names={'pothole','breadwheel','shoes','shield','signal'}
    assert len(g['scenes'][g['scene']]['nodes'])==13, 'Use the original thirteen-prop baseline'
    assert not new_names.intersection(o.get('name') for o in g['nodes'])
    assert {n['nodes'][i]['name'] for i in n['scenes'][n['scene']]['nodes']}==new_names
    offsets={k:len(g.get(k,[])) for k in ('nodes','meshes','accessors','bufferViews','materials')}
    for v in n['bufferViews']:v['byteOffset']=v.get('byteOffset',0)+len(b)
    for a in n['accessors']:a['bufferView']+=offsets['bufferViews']
    for m in n['meshes']:
        for p in m['primitives']:
            p['indices']+=offsets['accessors'];p['material']+=offsets['materials']
            p['attributes']={k:v+offsets['accessors'] for k,v in p['attributes'].items()}
    for o in n['nodes']:
        if 'mesh' in o:o['mesh']+=offsets['meshes']
        if 'children' in o:o['children']=[v+offsets['nodes'] for v in o['children']]
    for k in offsets:g.setdefault(k,[]).extend(n.get(k,[]))
    g['scenes'][g['scene']]['nodes'].extend(v+offsets['nodes'] for v in n['scenes'][n['scene']]['nodes'])
    for key in ('extensionsUsed','extensionsRequired'):
        if key in n:g[key]=list(dict.fromkeys(g.get(key,[])+n[key]))
    data=b+d;g['buffers'][0]['byteLength']=len(data)
    meta=json.dumps(g,separators=(',',':')).encode();meta+=b' '*(-len(meta)%4)
    OUT.write_bytes(struct.pack('<III',0x46546c67,2,28+len(meta)+len(data))+struct.pack('<II',len(meta),0x4e4f534a)+meta+struct.pack('<II',len(data),0x004e4942)+data)

def verify():
    old,b=read(BASE);g,d=read(OUT)
    for key in ('nodes','meshes','accessors','bufferViews','materials'):
        assert g[key][:len(old[key])]==old[key],key
    assert d[:len(b)]==b
    report={'baselineSha256':hashlib.sha256(BASE.read_bytes()).hexdigest(),'preservedNodes':len(old['nodes']),'preservedBinaryBytes':len(b),'unchangedOriginalEntries':True}
    (HERE/'.cache/preservation.json').write_text(json.dumps(report))
    print(report)
if __name__=='__main__':append();verify()

#!/usr/bin/env python3
"""Check delivered loop endpoints; optionally reproduce one score in isolated temp storage."""
import argparse, hashlib, json, pathlib, tempfile
import numpy as np
import render

p=argparse.ArgumentParser()
p.add_argument('--reproduce',choices=list(render.SCORES))
a=p.parse_args()
if a.reproduce:
    name=a.reproduce
    expected={ext:hashlib.sha256((render.OUT/f'{name}.{ext}').read_bytes()).hexdigest() for ext in ('m4a','ogg')}
    with tempfile.TemporaryDirectory() as folder:
        render.SRC=pathlib.Path(folder)/'sources'
        render.OUT=pathlib.Path(folder)/'audio'
        render.SCORES={name:render.SCORES[name]}
        render.main()
        for ext,digest in expected.items():
            assert hashlib.sha256((render.OUT/f'{name}.{ext}').read_bytes()).hexdigest()==digest,(name,ext,'non-identical rerender')
    print('Byte-identical MIDI synthesis/master/encode rerender:',name)
else:
    report=json.loads((render.SRC/'validation.json').read_text())
    for name,track in report['tracks'].items():
      for ext,encoding in track['encodings'].items():
        path=render.OUT/f'{name}.{ext}'
        assert hashlib.sha256(path.read_bytes()).hexdigest()==encoding['sha256']
        decoded,_=render.ff(['-i',path,'-f','f32le','-ac','2','-ar',44100,'-'])
        samples=np.frombuffer(decoded,dtype='<f4').reshape(-1,2)
        assert len(samples)>=track['loop_frames']-1,(name,ext,len(samples))
        samples=samples[:track['loop_frames']]
        seam=float(np.max(np.abs(samples[0]-samples[-1])))
        assert seam<.025,(name,ext,'seam jump',seam)
        assert np.max(np.abs(samples))<1
        encoding['decoded_loop_seam_step_dbfs']=float(20*np.log10(max(seam,1e-12)))
        print(name,ext,'seam dBFS',round(encoding['decoded_loop_seam_step_dbfs'],2))
    (render.SRC/'validation.json').write_text(json.dumps(report,indent=2)+'\n')

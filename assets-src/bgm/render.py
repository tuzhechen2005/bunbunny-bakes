#!/usr/bin/env python3
"""Original Bunbunny scores; deterministic MIDI -> FluidR3 -> circular PCM -> codecs."""
import hashlib, json, math, pathlib, re, shutil, struct, subprocess, tempfile
import numpy as np

SRC = pathlib.Path('assets-src/bgm')
OUT = pathlib.Path('public/audio/bgm')
SF = pathlib.Path('/usr/share/sounds/sf2/FluidR3_GM.sf2')
RATE = 44100
# GM programs are zero based. No borrowed MIDI, songs, loops, or recordings.
SCORES = {
 'big': dict(bpm=112, bars=32, tonic=65, scale=[0,2,4,5,7,9,11], programs=[45,9,32,48], volumes=[84,57,58,30], pan=[48,82,64,64], progression=[0,3,0,4,5,3,1,4], motif=[0,2,4,2,1,0,2,4,5,4,2,1,3,2,1,4]),
 'tu': dict(bpm=100, bars=28, tonic=62, scale=[0,2,4,5,7,9,11], programs=[12,24,32,10], volumes=[83,65,53,32], pan=[56,78,64,40], progression=[0,5,1,4,0,3,4], motif=[2,4,5,4,1,2,4,1,0,2,1,4,3,2,1,6]),
 'm3': dict(bpm=88, bars=24, tonic=58, scale=[0,2,4,5,7,9,11], programs=[4,4,32,11], volumes=[76,61,78,25], pan=[58,76,64,40], progression=[0,5,1,4,3,4], motif=[2,4,6,4,1,2,4,2,0,2,3,2,1,3,2,6]),
 'grab': dict(bpm=128, bars=36, tonic=67, scale=[0,2,4,5,7,9,11], programs=[78,24,33,73], volumes=[64,89,62,35], pan=[67,46,64,82], progression=[0,3,5,4,0,1,3,4,4], motif=[4,4,2,0,1,2,4,5,4,2,1,0,2,3,1,6]),
 'run': dict(bpm=140, bars=40, tonic=57, scale=[0,2,3,5,7,8,10], programs=[12,80,38,48], volumes=[82,41,67,32], pan=[54,80,64,68], progression=[0,5,2,6,0,3,5,4,2,6], motif=[0,4,2,4,0,4,3,4,2,4,6,4,5,4,2,1]),
 'td': dict(bpm=104, bars=28, tonic=63, scale=[0,2,4,5,7,9,11], programs=[70,71,42,48], volumes=[82,63,64,50], pan=[54,77,64,48], progression=[0,3,5,1,3,4,4], motif=[0,4,2,3,4,5,4,2,3,2,1,4,2,1,6,4]),
}

def command(args):
    p = subprocess.run([str(a) for a in args], capture_output=True, check=True)
    return p.stdout, p.stderr.decode(errors='replace')

def ff(args):
    return command(['ffmpeg','-hide_banner','-nostdin','-y',*args])

def vlq(n):
    b=[n & 127]
    while n >> 7:
        n >>= 7
        b.insert(0,(n & 127)|128)
    return bytes(b)

def compose(name, s, path):
    events=[]
    tempo=round(60000000/s['bpm'])
    def event(t, data): events.append((round(t*960),data))
    def note(t,ch,p,d=.35,v=64):
        event(t,bytes([0x90|ch,p,v]))
        event(t+d,bytes([0x80|ch,p,0]))
    def pitch(degree, octave=0):
        return s['tonic']+s['scale'][degree%7]+12*(degree//7+octave)
    event(0,b'\xff\x51\x03'+tempo.to_bytes(3,'big'))
    event(0,b'\xff\x58\x04\x04\x02\x18\x08')
    for ch,program in enumerate(s['programs']):
        event(0,bytes([0xc0|ch,program]))
        for cc,value in [(7,s['volumes'][ch]),(10,s['pan'][ch]),(91,20),(93,0)]:
            event(0,bytes([0xb0|ch,cc,value]))
    event(0,bytes([0xc4,47]))
    event(0,bytes([0xb4,7,43]))
    event(0,bytes([0xc9,40 if name=='m3' else 0]))
    event(0,bytes([0xb9,7,66 if name=='run' else 48]))
    event(0,bytes([0xb9,91,8]))
    # Three identical cycles: first warms reverberation, next is the delivered loop.
    for cycle in range(3):
      for bar in range(s['bars']):
        t=(cycle*s['bars']+bar)*4
        deg=s['progression'][(bar//2)%len(s['progression'])]
        # Runner's second half lifts explicitly to C, F, G, C before Am turnaround.
        if name=='run' and 20<=bar<36:
            deg=[2,5,6,2][((bar-20)//2)%4]
        chord=[pitch(deg+i,-1) for i in [0,2,4]]
        if name=='m3': chord.append(pitch(deg+6,-1))
        section=bar//8
        # Four-bar call/answer cells with two-beat breathing space at phrase ends.
        cell=s['motif'][(bar%4)*4:(bar%4+1)*4]
        if name=='big': rhythm=[0,.75,1.5,2.5]; lengths=[.36,.32,.48,.65]
        elif name=='tu': rhythm=[.25,1,1.75,2.75]; lengths=[.40,.38,.48,.58]
        elif name=='m3': rhythm=[.12,1.16,2.12,2.83]; lengths=[.65,.6,.48,.85]
        elif name=='grab': rhythm=[0,.5,1.5,2.5]; lengths=[.26,.38,.62,.65]
        elif name=='run': rhythm=[0,.75,1.5,2.5]; lengths=[.30,.3,.35,.65]
        else: rhythm=[0,1.5,2,3]; lengths=[1.15,.35,.7,.65]
        for j,d in enumerate(cell):
            if bar%4==3 and j==3: continue
            if name=='m3' and bar%2==1 and j==1: continue
            # B phrase changes contour; resolve toward current chord without large leaps.
            degree=d+(2 if section%2 and j in (1,2) else 0)
            if bar==s['bars']-1: degree=[4,3,1,6][j]
            lead=pitch(degree,0 if name in ('big','tu','td','grab') else 1)
            if name=='td' and section%2: lead-=12
            note(t+rhythm[j],0,lead,lengths[j],64+[4,-5,0,-8][j])
            if name=='big' and j in (0,2): note(t+rhythm[j]+.015,1,lead+12,.32,48)
            if name=='grab' and section%2 and j==0: note(t,3,lead,.7,43)
        # Distinct accompaniment language per game.
        if name=='big':
            for beat in [0,1,2,3]:
                for p in chord[1:]: note(t+beat+.5,0,p,.18,40)
        elif name in ('tu','grab'):
            # Close ukulele-style voicing in grab, nylon acoustic arpeggios in tu.
            voicing=sorted([p+12 if p<60 else p for p in chord])
            if name=='grab': voicing=[p+12 if p<67 else p for p in voicing]
            for k in range(8):
                if name=='tu': note(t+k*.5,1,voicing[k%3],.42,48+(k%2)*6)
                else:
                    for j,p in enumerate(voicing): note(t+k*.5+j*.018,1,p,.17,42+(k%2)*8-j*2)
        elif name=='m3':
            for beat in [.08,1.78,3.12]:
                for j,p in enumerate(chord): note(t+beat+j*.014,1,p,.72,48-j*2)
        elif name=='run':
            for k in range(8):
                note(t+k*.5,1,chord[[0,2,1,2][k%4]]+12,.19,49+(k%2)*5)
            if 20<=bar<36:
                for p in chord: note(t,3,p+12,3.6,40)
        else:
            for beat in [0,2]:
                for p in chord: note(t+beat,3,p,1.65,46)
            if bar%4 in (2,3):
                for j in [0,2]: note(t+j,1,pitch(cell[j]),.85,48)
        # Bass follows the harmony, avoiding a dense sub layer.
        root=pitch(deg,-2)
        while root<34: root+=12
        for beat,offset in [(0,0),(2,7)]:
            note(t+beat,2,root+offset,1.35 if name=='m3' else .65,63)
        if name=='run':
            for beat in [1,3,3.5]: note(t+beat,2,root,.3,55)
        # MIDI percussion only, no prerecorded rhythm loops.
        if name=='big':
            for beat in [0,2]: note(t+beat,9,36,.12,43)
            for beat in [1,3]: note(t+beat,9,37,.1,31)
        elif name=='tu':
            for k in range(8): note(t+k*.5,9,82,.1,33+(k%2)*9)
            if bar%2==0: note(t,9,36,.1,28)
        elif name=='m3':
            for beat in [0,2.5]: note(t+beat,9,36,.1,41)
            for beat in [1.08,3.08]: note(t+beat,9,38,.15,38)
            for k in range(8): note(t+k*.5+(0.09 if k%2 else 0),9,42,.12,27+(k%2)*6)
        elif name=='grab':
            for beat in [0,2]: note(t+beat,9,36,.12,54)
            for beat in [1,3]: note(t+beat,9,39,.12,48)
            for k in range(8): note(t+k*.5,9,42,.1,31+(k%2)*5)
        elif name=='run':
            for beat in [0,1.5,2,3.5]: note(t+beat,9,36,.15,65)
            for beat in [1,3]: note(t+beat,9,38,.12,57)
            for k in range(8): note(t+k*.5,9,42,.1,37+(k%2)*6)
        else:
            if bar%4==0: note(t,4,pitch(deg,-2),1.4,45)
            for beat in [0,2]: note(t+beat,9,36,.15,42)
            for beat in [1,3]: note(t+beat,9,38,.12,42)
            if bar%4==3:
                for k in range(4): note(t+3+k*.25,9,38,.10,24+k*5)
    event(s['bars']*12+8,b'\xff\x2f\x00')
    data=b''; previous=0
    for tick,msg in sorted(events,key=lambda x:(x[0],x[1])):
        data+=vlq(tick-previous)+msg; previous=tick
    path.write_bytes(b'MThd'+struct.pack('>IHHH',6,0,1,960)+b'MTrk'+struct.pack('>I',len(data))+data)
    return round(s['bars']*4*tempo/1e6*RATE)

def measure(path):
    _,err=ff(['-i',path,'-af','loudnorm=I=-16:TP=-1.5:LRA=9:print_format=json','-f','null','-'])
    return json.loads(err[err.rfind('{'):err.rfind('}')+1])

def main():
    SRC.mkdir(exist_ok=True,parents=True); OUT.mkdir(exist_ok=True,parents=True)
    (SRC/'midi').mkdir(exist_ok=True)
    shutil.copyfile('/usr/share/doc/fluid-soundfont-gm/copyright',SRC/'SOUNDFONT-LICENSE.txt')
    report={'soundfont_sha256':hashlib.sha256(SF.read_bytes()).hexdigest(),'tracks':{}}
    report['tools']=command(['dpkg-query','-W','-f=${Package} ${Version}\n','python3','python3-numpy','fluidsynth','fluid-soundfont-gm','ffmpeg'])[0].decode()
    with tempfile.TemporaryDirectory(prefix='bunbunny-bgm-') as tmp:
      w=pathlib.Path(tmp)
      for name,s in SCORES.items():
        print('Rendering '+name,flush=True)
        midi=SRC/'midi'/f'{name}.mid'; n=compose(name,s,midi)
        command(['fluidsynth','-ni','-F',w/'raw.wav','-T','wav','-O','float','-r',RATE,'-g','.55','-o','synth.cpu-cores=1','-o','synth.chorus.active=0','-o','synth.reverb.room-size=0.35','-o','synth.reverb.damp=0.65','-o','synth.reverb.level=0.16',SF,midi])
        ff(['-i',w/'raw.wav','-af','highpass=f=45,lowpass=f=12000,acompressor=threshold=0.13:ratio=1.6:attack=18:release=180:makeup=1','-f','f32le','-ac','2',w/'processed.f32'])
        pcm=np.fromfile(w/'processed.f32',dtype='<f4').reshape(-1,2)
        loop=pcm[n:2*n].copy()
        # Last 250 ms blends into the exact predecessor of the first sample.
        # Same musical position in adjacent cycles; no beat is lost or repeated.
        cross=11025; weight=np.linspace(0,1,cross)[:,None]
        loop[-cross:]=loop[-cross:]*(1-weight)+pcm[n-cross:n]*weight
        loop.astype('<f4').tofile(w/'loop.f32')
        ff(['-f','f32le','-ar',RATE,'-ac','2','-i',w/'loop.f32','-c:a','pcm_f32le',w/'loop.wav'])
        stats=measure(w/'loop.wav')
        gain=10**((-16-float(stats['input_i']))/20)
        loop*=gain
        # Lookahead peak guard on repeated audio, retaining a warmed circular middle.
        np.tile(loop,(3,1)).astype('<f4').tofile(w/'guard-input.f32')
        ff(['-f','f32le','-ar',RATE,'-ac','2','-i',w/'guard-input.f32','-af','alimiter=limit=0.70:attack=5:release=80:level=false:latency=true','-f','f32le',w/'guard.f32'])
        loop=np.fromfile(w/'guard.f32',dtype='<f4').reshape(-1,2)[n:2*n].copy()
        loop.astype('<f4').tofile(w/'guard-loop.f32')
        ff(['-f','f32le','-ar',RATE,'-ac','2','-i',w/'guard-loop.f32','-c:a','pcm_f32le',w/'guard-loop.wav'])
        corrected=measure(w/'guard-loop.wav')
        loop*=10**((-16-float(corrected['input_i']))/20)
        assert np.max(np.abs(loop))<.90, (name,'master needs peak control',np.max(np.abs(loop)))
        loop.astype('<f4').tofile(w/'master.f32')
        base=['-f','f32le','-ar',RATE,'-ac','2','-i',w/'master.f32','-map_metadata','-1','-fflags','+bitexact','-flags:a','+bitexact']
        ff([*base,'-c:a','aac','-b:a','96k','-movflags','+faststart',OUT/f'{name}.m4a'])
        ff([*base,'-c:a','libvorbis','-q:a','3',OUT/f'{name}.ogg'])
        item={'bpm':s['bpm'],'bars':s['bars'],'loop_frames':n,'duration_seconds':n/RATE,'master_sample_peak_dbfs':float(20*np.log10(np.max(np.abs(loop)))),'master_seam_step_dbfs':float(20*np.log10(max(np.max(np.abs(loop[0]-loop[-1])),1e-12))),'encodings':{}}
        for ext in ['m4a','ogg']:
            path=OUT/f'{name}.{ext}'; loud=measure(path)
            probe=json.loads(command(['ffprobe','-v','error','-show_format','-show_streams','-of','json',path])[0])
            stream=probe['streams'][0]
            assert path.stat().st_size<=1100000
            assert stream['sample_rate']=='44100' and stream['channels']==2
            assert 60<=float(probe['format']['duration'])<=90
            decoded,_=ff(['-i',path,'-f','f32le','-ac','2','-ar',RATE,'-'])
            samples=np.frombuffer(decoded,dtype='<f4').reshape(-1,2)[:n]
            seam=float(np.max(np.abs(samples[0]-samples[-1])))
            assert np.max(np.abs(samples))<1.0
            assert seam<0.025,(name,ext,'loop seam',seam)
            assert abs(float(loud['input_i'])+16)<.4,(name,loud)
            assert float(loud['input_tp']) < -1.0,(name,loud)
            item['encodings'][ext]={'bytes':path.stat().st_size,'decoded_loop_seam_step_dbfs':float(20*np.log10(max(seam,1e-12))),'integrated_lufs':float(loud['input_i']),'true_peak_dbtp':float(loud['input_tp']),'duration_seconds':float(probe['format']['duration']),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
        report['tracks'][name]=item
        print(json.dumps(item),flush=True)
    (SRC/'validation.json').write_text(json.dumps(report,indent=2)+'\n')

if __name__=='__main__': main()

# Bunbunny Bakes — original mini-game background music

Six original instrumental scores composed for the soft clay / dawn-light direction in
`docs/GAME_ART.md`. All notes, harmony, rhythms and arrangements are authored in
`render.py`; no existing songs, MIDI arrangements, recorded music or rhythm loops
were imported. The instrument samples are from the licensed GM soundfont below.
Only audio deliverables and their production sources are changed; no game integration.

## Tracks

Each basename has both `.m4a` (AAC-LC, 96 kbit/s target) and `.ogg` (Vorbis quality 3)
in `public/audio/bgm/`. All are stereo, 44,100 Hz. Exact durations, frame counts,
decoded loudness / true peaks, file sizes and SHA-256 hashes are in `validation.json`.

| File | Game | Tempo / key | Length | Arrangement |
|---|---|---|---|---|
| `big` | 消除大面包 | 112 BPM, F major | 32 bars, 68.57 s | Bouncy pizzicato call/answer, restrained glockenspiel highlights, soft kick and rim taps. |
| `tu` | 兔了个兔 | 100 BPM, D major | 28 bars, 67.20 s | Curious marimba phrase, gently alternating nylon acoustic guitar arpeggios, quiet shaker. |
| `m3` | 兔兔三连烤 | 88 BPM, B♭ major | 24 bars, 65.45 s | Rhodes melody and softly staggered seventh chords (B♭maj7 home), upright bass, brush kit, lightly swung hats. Warm lo-fi through soft transients and dark balance, without added hiss. |
| `grab` | 兔兔夹面包 | 128 BPM, G major | 36 bars, 67.50 s | Whistle hook, flute answers, short ukulele-style strums, claps and a light kick. Energetic without an alarm sound. |
| `run` | 兔兔跑酷 | 140 BPM, A minor → C major | 40 bars, 68.57 s | Marimba melody, short synth-pluck ostinato, synth bass and punchy drums. Bars 21–36 lift to C–F–G–C; final phrase turns back toward A minor. |
| `td` | 保卫大面包！ | 104 BPM, E♭ major | 28 bars, 64.62 s | Bassoon theme, clarinet replies, soft strings/cello, understated snare rolls and occasional low timpani. A toy-town march. |

GM timbre detail: FluidR3 has no dedicated ukulele program. `grab` uses its nylon
guitar with short releases and close, high voicing as a ukulele
approximation; it is not a separately sampled ukulele. `m3` selects drum program
40 (zero-based brush kit). `run` uses short articulated GM square-synth notes as
its pluck layer. All program numbers and balances are explicit in the score.

## Soundfont and redistribution

**FluidR3_GM.sf2**, Debian `fluid-soundfont-gm` 3.1-5.3; Frank Wen, with Toby
Smithe and the contributors named in [SOUNDFONT-LICENSE.txt](SOUNDFONT-LICENSE.txt).
This file is the complete copyright/licence notice copied from the installed
package, not a paraphrase. Soundfont SHA-256 is recorded in `validation.json`.

The soundfont itself is **MIT licensed**. The grant permits use, modification,
publishing, distribution and sale, so distributing original music rendered with
it is permitted, including commercial game audio. Retain the supplied notice
with these production sources / redistributed asset bundles. Debian's packaging
has its own GPL notice; that does not relicense the soundfont or these original
compositions. The full soundfont is installed inside the Docker image rather
than copied into the repository.

Sources: [Debian package](https://packages.debian.org/bookworm/fluid-soundfont-gm),
[Debian source copyright](https://sources.debian.org/src/fluid-soundfont/3.1-5.3/debian/copyright/).
These links are informational; rendering requires no web access.

## Re-render

From the repository root, with Docker running:

```sh
# One-time dependency provisioning needs network access.
# The architecture and base digest are pinned; apt versions are locked.
DOCKER_BUILDKIT=0 docker build --platform linux/arm64 -t bunbunny-bgm:1 assets-src/bgm

# Composition, synthesis, mastering, encoding and validation run entirely offline.
# Mount only the two authorized directories; temporary PCM stays in the container.
docker run --rm --network none --platform linux/arm64 \
  -v "$PWD/assets-src/bgm:/work/assets-src/bgm" \
  -v "$PWD/public/audio/bgm:/work/public/audio/bgm" \
  bunbunny-bgm:1
```

The legacy builder setting avoids a host buildx-cache write outside this worktree;
it does not alter the render. The script uses Python + NumPy and a small standard
MIDI-file writer (960 ticks/quarter), FluidSynth, FFmpeg/libvorbis and FFprobe.
There are no pip dependencies, random seeds, audio devices or online services.
Installed versions are recorded in `validation.json`; the complete Debian package
lock and `toolchain-image.txt` preserve provenance. If a locked package disappears
from the live mirror, restore the saved image or fetch that version from Debian's
snapshot archive rather than silently updating the lock.

For fully offline transfer to another machine, save the provisioned image once
(outside the repository), then load it on the target machine:

```sh
docker save bunbunny-bgm:1 -o /tmp/bunbunny-bgm-toolchain.tar
docker load -i /tmp/bunbunny-bgm-toolchain.tar
```

Use the same linux/arm64 image for byte-identical rerenders. Cross-architecture
floating-point synthesis is not guaranteed byte-identical. The MIDI files include
three complete cycles and a release tail for rendering; the delivered audio is
exactly one cycle. Temporary WAV/float intermediates are deleted automatically.

## Loop construction and mastering

Three identical cycles are rendered with FluidSynth's small-room reverb, chorus
off and one synthesis CPU. High-pass at 45 Hz, low-pass at 12 kHz and gentle 1.6:1
compression (18 ms attack / 180 ms release) reduce rumble and soften transients.
The middle cycle is extracted after the synth and compressor have warmed up.
Its last 250 ms is crossfaded with the same musical interval immediately before
its start in the preceding cycle. The final sample therefore connects naturally
to the first, preserving note tails without shortening a bar or adding silence.
No fade-in/fade-out is inserted into the loop.

FFmpeg's BS.1770 loudness measurement determines a constant gain to −16 LUFS.
A 5 ms lookahead / 80 ms release peak guard runs on three repeated cycles,
then the middle cycle is extracted and its loudness remeasured for a final
constant-gain correction. This keeps the limiter state circular. Final lossy decodes are measured
again. The renderer rejects files above 1,100,000 bytes, wrong channel/rate,
loudness more than 0.4 LU from target, or true peaks at/above −1 dBTP. This leaves
headroom for game sound effects; game mixing volume can be set independently.

AAC carries encoder priming/padding in its MP4 timing metadata, and Vorbis carries
its exact endpoint in the Ogg granule position. Gapless playback must honor those
codec timestamps; arbitrary HTML media restart scheduling can still introduce a
player gap. `loop_frames` in the report specifies the intended PCM endpoint for
sample-accurate playback. This asset task makes no playback-code changes.

## Verification

```sh
# Recheck delivered hashes and decoded loop joins.
docker run --rm --network none -e PYTHONDONTWRITEBYTECODE=1 --entrypoint python3 \
  -v "$PWD/assets-src/bgm:/work/assets-src/bgm" \
  -v "$PWD/public/audio/bgm:/work/public/audio/bgm:ro" \
  bunbunny-bgm:1 assets-src/bgm/check.py

# Reproduce one complete track in container temp storage and compare both files.
docker run --rm --network none -e PYTHONDONTWRITEBYTECODE=1 --entrypoint python3 \
  -v "$PWD/assets-src/bgm:/work/assets-src/bgm:ro" \
  -v "$PWD/public/audio/bgm:/work/public/audio/bgm:ro" \
  bunbunny-bgm:1 assets-src/bgm/check.py --reproduce big
```

The repeat-render check leaves delivered files untouched. Endpoint checks decode
each codec and compare the samples immediately around the intended wrap point;
the report retains the measured seam step. These are signal/format checks, not a
claim of listening review or browser playback testing.

Delivery verification: all 12 files passed; durations 64.62–68.57 seconds,
integrated loudness −16.04 to −15.97 LUFS, decoded true peaks no higher than
−2.10 dBTP, maximum file size 932,602 bytes. Decoded seam steps range from
−75.66 to −41.53 dBFS. `check.py --reproduce big` passed with byte-identical
AAC and Vorbis outputs. The locked Docker build succeeded and its installed
package list matched `apt-packages.lock` exactly.

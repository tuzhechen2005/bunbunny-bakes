# D-ART2 — larger clay bakery-defense sprites

Original procedural Blender geometry, following `docs/GAME_ART.md` and the soft,
matte clay look of `public/brand/art/game/`. No downloaded models, textures, fonts,
or runtime 3D. Only the art source and TD delivery directories are changed.

D-ART2 doubles every tower, pest, projectile and effect frame. Models also occupy
more of the frame: towers have 16% larger geometry and projectiles 24% larger
geometry relative to their old framing. Pests have been remodelled with plump
bodies, bigger heads, expressive eyes, round feet and six actual gait/wing poses.
The boss is 22% larger than the new mouse in model space, with a puffy chef hat,
apron, brass buttons and red neckerchief.

All seven tower families have three distinct tiers, broad rounded bevels and a
colour identity: maple/gold pin, pale celadon sifter, sage whisk, terracotta-red
oven, icy blue freezer, berry-pink piping bag, and caramel-gold torch. Modelled
seams, collars, sieve holes, cream swirls, arch bricks, snowflakes, nozzle teeth,
and fuel gauges provide detail at full resolution while the major forms remain
readable at phone size. The preview includes every tower and pest at a 60px frame
width as well as enlarged inspection views.

Maps are no longer rendered or shipped: the frontend draws them. The optional
80 × 80 placement pad remains for compatibility. No frontend code is changed.

## Docker Blender pipeline

From the repository root, with Docker and Node dependencies installed:

```sh
mkdir -p assets-src/td/.cache
# Skip these image builds when the images already exist locally.
BUILDX_CONFIG="$PWD/assets-src/td/.cache/buildx" \
  docker build -t bunbunny-run-render -f assets-src/run/Dockerfile assets-src/run
BUILDX_CONFIG="$PWD/assets-src/td/.cache/buildx" \
  docker build --network none -t bunbunny-td-render -f assets-src/td/Dockerfile assets-src/td

docker run --rm --network none \
  -v "$PWD:/work:ro" -v "$PWD/assets-src/td:/work/assets-src/td" \
  bunbunny-td-render
node assets-src/td/pack.mjs
```

The Docker image uses Debian Blender 4.3.2 / Cycles CPU. It reads the repository
through a read-only mount, writes only this art source directory, and has no
network access. Native Blender may also run the source script, but Docker avoids
the Metal-discovery crash documented in the runner pipeline.

In a dependency-free worktree, the packer can reuse an existing checkout's Sharp
installation without changing this checkout's package files:

```sh
NODE_PATH=/absolute/path/to/existing-checkout/node_modules node assets-src/td/pack.mjs
```

Every frame renders at **2× the shipped frame resolution**, 128 samples, fixed
seed, no denoiser. For example, a tower renders at 512 × 576 and ships at
256 × 288. Packing downsamples with Lanczos3, then encodes WebP quality 90,
alpha quality 100. All enlarged sprites share **112 source pixels per metre**;
the unchanged slot uses 56. The camera is orthographic, **55° above horizontal**,
looking from -Y with +X screen-right. Warm sunlight, cool ambient fill and two
broad grazing rim lights shape the matte clay. Finite transparent ground-shadow
decals prevent rectangular halos or clipped infinite shadow catchers.

The renderer checkpoints `.cache/renders.json` after every complete atlas.
A full build creates the complete new set; later subset rebuilds are supported:

```sh
docker run --rm --network none \
  -v "$PWD:/work:ro" -v "$PWD/assets-src/td:/work/assets-src/td" \
  bunbunny-td-render -- --only tower-freezer-2,pest-boss --samples 128
node assets-src/td/pack.mjs
```

Use one sample count for all assets. The packer rejects mixed render settings,
old art revisions, incomplete sets, and unexpected public files. Checkpointing
automatically discards retired map records and old-revision cache entries. All
geometry and poses live in `render.py`; no `.blend` files are required.

## Runtime atlas contract

`public/brand/td/manifest.json` retains the **version-3 runner format**:
`baseUrl`, `pixelRatio`, `colorSpace`, `renderer`, `camera`, `coordinates`, `assets`.
Every asset retains `file`, `frameSize`, `frameCount`, `columns`, `rows`,
`pixelsPerMetre`, `fps`, `loop`, `anchor`, `frames`, and `bytes`. Every frame retains
`rect`, `anchor`, and `contentBounds`. Pest `facing` metadata remains compatible.

| IDs | Frames each | Shipped frame size | Playback / tier progression |
| --- | ---: | --- | --- |
| `tower-pin-0..2` | 1 | 256 × 288 | maple roller → brass reinforcement → double roller |
| `tower-sifter-0..2` | 1 | 256 × 288 | perforated cup → crank → flour chamber |
| `tower-whisk-0..2` | 1 | 256 × 288 | single whisk → twin whisks → stand mixer |
| `tower-oven-0..2` | 1 | 256 × 288 | brick arch oven → chimney → double chamber |
| `tower-freezer-0..2` | 1 | 256 × 288 | icebox → insulated reservoir → ice crown |
| `tower-piping-0..2` | 1 | 256 × 288 | folded bag → pressure arms → triple nozzle |
| `tower-torch-0..2` | 1 | 256 × 288 | gauge torch → reinforced tank → twin burner |
| `pest-ant`, `pest-mouse`, `pest-beetle` | 6 | 224 × 224 | 10 fps loop |
| `pest-boss` | 6 | 224 × 224 | 10 fps loop; larger mouse chef |
| `pest-sparrow` | 6 | 224 × 224 | 12 fps wing cycle; airborne with ground shadow |
| `proj-pin`, `proj-whisk`, `proj-oven` | 1 | 128 × 128 | static; optional runtime spin |
| `fx-hit` | 4 | 160 × 160 | flour puff + dough crumbs; 16 fps, once |
| `fx-bomb` | 4 | 160 × 160 | expanding caramel explosion; 16 fps, once |
| `fx-freeze` | 4 | 160 × 160 | frost ring + rounded ice crystals; 16 fps, once |
| `fx-slide` | 4 | 160 × 160 | butter pat + sliding streaks; 16 fps, once |
| `slot` | 1 | 80 × 80 | optional static placement overlay |

**34 atlases / 71 frames.** Frames are untrimmed, row-major, all in one row:
`columns === frameCount`, `rows === 1`. Pest sheets are 1344 × 224 and effect
sheets 640 × 160. Coordinates are top-left **source pixels**. `contentBounds` is
local to its frame, never atlas space. `anchor` is the projected world ground
origin, fixed through the entire animation. Towers use a higher camera target
for safe clearance around their tallest upgrades, with the corresponding anchor
recorded in the manifest. Do not recenter individual frames to alpha bounds.

Pests face **right (+X)** in every frame. These six frames are animation poses,
not directions. The game can rotate the image about `frame.anchor` by
`Math.atan2(dy, dx)` in Canvas screen coordinates; baked shadows rotate with it.
Reduced motion may hold frame zero. Towers stay upright. Pin and oven projectiles
point right; the whisk projectile is radially symmetric.

The frame dimensions and anchors have doubled relative to the old sprites. To
keep a frame's previous displayed size, use half its previous drawing scale;
for a 40% larger displayed frame, use **0.7 × the previous drawing scale**. The
model changes additionally improve coverage inside those frames. The unchanged
slot keeps its previous scale. `pixelRatio: 2` is display-density metadata;
`renderer.supersample: 2` has already been resolved by the packer and must not
be applied to frame rectangles again. The consuming frontend owns display size.

## Offline QA and deliverables

`node assets-src/td/pack.mjs` checks the complete ID set, version-3 runner field
types, exact requested dimensions, 2× render input dimensions, uniform renderer
settings, fps/loop values, fixed anchors, nonempty alpha, safe edge margins,
unique animation frames, visible adjacent-pose motion (including the loop seam),
a larger boss silhouette, decoded atlas dimensions and a **1,600,000-byte total
public directory budget including the manifest**. No map data dependency remains.

- `preview.png`: contact sheet made from the **decoded shipped WebPs**, showing
  all 21 towers, all 30 pest poses, three projectiles, all 16 effect frames, the
  slot, phone-size samples, and tan/sage/cocoa contrast swatches. This source-only preview is outside the runtime
  budget.
- `validation.json`: measured public byte total, asset/frame counts and checks.
- `.cache/`: ignored high-resolution renders, metadata and render logs.

Review the preview locally after packing; no application server is required.

Verified D-ART2 delivery: **669,784 bytes / 1,600,000 bytes** including manifest,
34 atlases and 71 frames. All automated checks passed. The decoded contact sheet
was inspected at enlarged and 60px frame sizes, including the board-colour
swatches. The boss has **1.691×** the mouse's opaque silhouette area. All tower
frames have at least 8px of transparent edge clearance; every shipped frame
passes the packer's margin check.

# Bakery defense artwork — L2 vertical serpentines

Original procedural Blender clay models, without downloaded models, textures, fonts,
or runtime 3D. The palette, AgX +0.6 EV, warm sun, cool ambient fill and matte clay
materials follow `assets-src/run`. The orthographic camera is **55° above horizontal**,
looking from -Y; +X is screen right. Compact radial ground shadows are baked into
sprite alpha, including the airborne sparrow's shadow. Finite transparent decals
avoid long cut-off shadows or noisy rectangular halos from an infinite shadow catcher;
the models retain physically lit surfaces and self-shadowing.

## Rebuild with the runner Docker toolchain

From the repository root, with Docker and the existing Node dependencies:

```sh
mkdir -p assets-src/td/.cache
# Skip this first build if bunbunny-run-render already exists locally.
BUILDX_CONFIG="$PWD/assets-src/td/.cache/buildx" \
  docker build -t bunbunny-run-render -f assets-src/run/Dockerfile assets-src/run
BUILDX_CONFIG="$PWD/assets-src/td/.cache/buildx" \
  docker build --network none -t bunbunny-td-render -f assets-src/td/Dockerfile assets-src/td
docker run --rm --network none \
  -v "$PWD:/work:ro" -v "$PWD/assets-src/td:/work/assets-src/td" \
  bunbunny-td-render
node assets-src/td/pack.mjs
```

`Dockerfile` reuses the runner image (Debian Blender 4.3.2, Cycles CPU) and changes
only the entrypoint. Rendering has no network access and can write only this source
directory. Native Blender is also supported by running `blender -b --factory-startup
--python-exit-code 1 --python assets-src/td/render.py`, but the runner README documents
a Metal-discovery crash on this Mac; Docker is the verified route.

All frames render at **2× final atlas resolution**, with 128 samples, no denoiser and
a fixed seed. `pack.mjs` downsamples with Lanczos3, then writes WebP quality 90,
alpha quality 100. All tower/pest/projectile/effect assets share **56 source pixels
per model metre**. Maps use 100 pixels/metre to fit the authoritative board and
inverse-project its ground coordinates; their dressing is sized separately.

The only generated intermediate files are in ignored `.cache/`. `render.py` checkpoints
metadata after every completed asset. After a complete build, a subset can be rebuilt:

```sh
docker run --rm --network none \
  -v "$PWD:/work:ro" -v "$PWD/assets-src/td:/work/assets-src/td" \
  bunbunny-td-render -- --only tower-oven-2,pest-sparrow --samples 128
node assets-src/td/pack.mjs
```

Use the same sample count for every asset. The packer rejects a mixed render setup.
No `.blend` file is needed: all geometry, poses, materials and lighting are in `render.py`.

## Runtime atlas contract

`public/brand/td/manifest.json` has the **same version-3 format** as
`public/brand/run/manifest.json`: `baseUrl`, `pixelRatio`, `colorSpace`, `renderer`,
`camera`, `coordinates`, and an `assets` object keyed by the requested IDs. Each asset
has `file`, `frameSize`, `frameCount`, `columns`, `rows`, `pixelsPerMetre`, `fps`, `loop`,
`anchor`, `frames`, and `bytes`. Every frame has `rect`, `anchor`, `contentBounds`.
Additional `map` and `facing` metadata describe alignment and rotation.

| IDs | Frames each | Source frame size | Playback |
| --- | ---: | --- | --- |
| `map-1`, `map-2`, `map-3` | 1 | 1440 × 810 | static, opaque, path only; slots drawn by frontend |
| `tower-pin-0..2` | 1 | 128 × 144 | maple pin → brass reinforced pin → double roller |
| `tower-sifter-0..2` | 1 | 128 × 144 | sieve cup → hand crank → stacked flour chamber |
| `tower-whisk-0..2` | 1 | 128 × 144 | single whisk → twin whisk → brass stand mixer |
| `tower-oven-0..2` | 1 | 128 × 144 | clay oven → chimney → reinforced double chamber |
| `pest-ant`, `pest-mouse`, `pest-beetle` | 4 | 112 × 112 | 8 fps loop |
| `pest-boss` | 4 | 112 × 112 | 8 fps loop; big round clay mouse, faces right |
| `pest-sparrow` | 4 | 112 × 112 | 10 fps wing cycle, airborne with ground shadow |
| `proj-pin`, `proj-whisk`, `proj-oven` | 1 | 64 × 64 | static; optional runtime spin |
| `fx-hit` | 4 | 80 × 80 | 16 fps, play once and remove |
| `slot` | 1 | 80 × 80 | static optional placement overlay |

There are 25 atlases / 43 frames. Coordinates are **top-left source pixels**, with
untrimmed row-major frames. `contentBounds` is local to its frame, not atlas space.
An anchor is the projected world ground origin, fixed over the animation; do not
recenter to the alpha bounds or the character will wobble while animating.

Pests face **right (+X)** in all four frames. The game rotates the sprite about
`frame.anchor` by `Math.atan2(dy, dx)` in Canvas screen coordinates. These are four
animation poses, **not** four directions. The baked shadow rotates with the sprite,
a deliberate single-direction atlas tradeoff. Reduced motion may hold frame zero
while retaining essential path movement. Towers are upright and need no rotation.
Pin and oven projectiles point right; the whisk projectile is radially symmetric.

At a 720 × 405 CSS board, map scale is 0.5: source maps are 1440 × 810. Use the same
board scale for actors (tower frames become 64 × 72 CSS px, with approximately 56px
visual footprints). `pixelRatio: 2` is the runner's nominal display-density metadata;
the renderer's separate `supersample: 2` is already resolved by the packer. Do not
halve frame rectangles or divide by supersampling again.

Maps anchor at **[0, 0]** and cover the full board. Sprite anchors are ground contacts:

```js
const asset = manifest.assets[id];
const frame = asset.frames[frameIndex];
ctx.save();
ctx.translate(x * boardScale, y * boardScale);
ctx.rotate(angle); // 0 for maps and upright towers
ctx.drawImage(image, ...frame.rect,
  -frame.anchor[0] * boardScale, -frame.anchor[1] * boardScale,
  asset.frameSize[0] * boardScale, asset.frameSize[1] * boardScale);
ctx.restore();
```

D2's loader should fetch `/brand/td/manifest.json`, decode `baseUrl + asset.file`, and
retain its placeholder path if manifest/image loading fails. This art-only task does
not change the runtime loader or other TypeScript. Do not draw a second path over these full map backgrounds. Draw all eleven slots in
the frontend; `slot` remains available as a placement overlay. Carried bread is drawn
with owner photos by the frontend; no carried-bread marker is included.

## Exact map alignment

`render.py` reads **`src/lib/td/maps.ts` directly**. It parses all three literal map
calls and fails if they are absent or no longer have eleven slots; coordinates are never
copied into source art. Map order is engine order:

1. Cooling rack → maple kitchen counter, mixing bowl and cooling trays.
2. Dough folds → cream/checker tiled shop floor with bakery supplies.
3. Proofing walk → sage back garden, terracotta herb pots and clay pebbles.

The camera target is the board center. For a map point `(x, y)` on a surface at height
`z`, world coordinates are `((x-720)/100, ((405-y)/100-z*cos(55°))/sin(55°), z)`.
This compensates both the oblique camera and raised surfaces. Blender projects every
path vertex and slot center back to pixels, asserting an error below **0.01px**.
The final manifest records these checks and the SHA-256 of the actual map source.

The route is one continuous 74px-wide surface with an 86px outer border. Its integer sampled rounded
centerline follows the engine exactly, including the diagonal turn segments. Eleven 42-unit-radius slot clearances remain in manifest metadata for alignment, but no pads are baked. Props reject path and slot clearances, and
the final 115px-radius endpoint apron stays empty for the game's bread pile. There is
**no baked bread**. Routes enter the top edge near the left and end in the interior with the entire 115px-radius
plate clearance inside the board. No plate is baked into the background.

Changing `maps.ts` requires rerendering **all three maps**. The packer refuses stale
map hashes or changed paths/slots, including when packing old caches after a source edit.

## Offline review and verification

`node assets-src/td/pack.mjs` validates the complete ID set, runner schema field types,
frame counts and rectangles, 2× input dimensions, decoded atlas dimensions, nonempty
alpha bounds, no clipped sprites/shadows, distinct animation frames, opaque maps,
exact projected route/slot positions, current map-source hash and the **1,500,000-byte
public directory budget including manifest**. Unexpected public files also fail.

`preview.png` is generated from the **decoded shipped WebPs**, not pristine PNGs. It
shows all three clean maps, route/slot overlays in small alignment insets, every tower
tier both enlarged and at 56px frame width, every pest pose, projectiles and hit puff.
Review it with a local image viewer; no browser or application server is needed.
The preview and source/cache files are not included in the runtime download budget.

Verified shipped total: **250,353 bytes**, including the manifest (25 atlases,
43 frames). The offline preview was inspected after WebP encoding; all tower tiers,
pest poses, path/slot overlays and transparency margins pass review.

L2 rerendered all three landscape backgrounds using Docker Blender; the existing
boss and other sprite models are retained. The
packer and decoded contact sheet verify eleven slot clearances, no baked pads, four
unique right-facing boss poses, unclipped alpha, unchanged version-3 manifest format,
and the public size budget. No browser or carried-bread marker is used.


## L2 layout review

Docker Blender renders all three backgrounds from v6 coordinates. The packer
regenerates numbered SVGs and `preview.png` from the same source; preview insets
show the actual plate center, 40 units back along the final vertical segment.
No pads or plates are baked. All routes descend first and sweep left to right,
with turns at y=70/740, a constant 74-unit surface / 86-unit border, and 11 slots
between runs. Map 3 includes one tighter lower turn (55 vs 70-unit corner radius).

![Cooling rack: three vertical runs](map-1-overview.svg)
![Dough folds: four vertical runs](map-2-overview.svg)
![Proofing walk: five vertical runs](map-3-overview.svg)

See `src/lib/td/README.md` for numbered slot roles and measured bot rates. Geometry
regression enforces ≥126 center spacing, ≥60 slot-rim board clearance, ≥60 path-edge
clearance, shortest-tower reach, two-run long-range coverage and ≥120 plate clearance.

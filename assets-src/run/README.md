# Dawn delivery art — R2 / D146

Original, procedurally modeled bakery-town sprites. White bunny courier, folded
kraft bread bag, hand-scored loaves, flour sacks, wooden bread cart, striped shop
awning, rain puddle, takeaway coffee, stone street, and three shop palettes per
side. All geometry, materials, posing, lighting, and the dawn gradient are built
in `render.py`. No downloaded models, textures, fonts, or runtime 3D assets.

Scope is art only: no R1 client/physics or R3 server changes. D103/D124/D136/D142
remain the game integration conventions; nothing here changes game rules.

## Re-render

From the repository root, with Blender and the existing Node dependencies:

```sh
/opt/homebrew/bin/blender -b --factory-startup --python-exit-code 1 \
  --python assets-src/run/render.py
node assets-src/run/pack.mjs
```

`render.py` uses Cycles CPU, 128 samples, denoising when available, a fixed random seed, an
orthographic camera, warm sun, and cool ambient fill. Clay renders use AgX at
+0.6 EV; the emissive sky uses Standard/sRGB to retain the dawn palette. It writes intermediate
RGBA PNGs and `renders.json` into the ignored `.cache/` directory. `pack.mjs`
uses the project's existing `sharp` dependency to write WebP sheets and
`manifest.json` into `public/brand/run/`, plus the unshipped `preview.png` here.
It fails if any required frames are missing, if sprites touch their frame edges,
if animation poses are duplicated, or if all shipped files exceed **1,500,000
bytes** (the stricter decimal interpretation of 1.5 MB).

If Blender needs writable user directories, use scoped environment variables:

```sh
mkdir -p assets-src/run/.cache/config assets-src/run/.cache/tmp
BLENDER_USER_CONFIG="$PWD/assets-src/run/.cache/config" \
TMPDIR="$PWD/assets-src/run/.cache/tmp" \
  /opt/homebrew/bin/blender -b --factory-startup --python-exit-code 1 \
  --python assets-src/run/render.py
```

On this machine Blender 5.2.2's headless executable crashed in
`supports_barycentric_whitelist` during Metal device discovery, before running
Python. Moving user/temp directories did not fix it; the macOS `bpy` 4.5.3 and
4.2.0 packages also crashed on import. The included optional Dockerfile runs
the same script with Debian's Blender 4.3.2 and Cycles CPU, without Metal or changes
to the installed Blender app:

```sh
BUILDX_CONFIG="$PWD/assets-src/run/.cache/buildx" \
  docker build -t bunbunny-run-render -f assets-src/run/Dockerfile assets-src/run
docker run --rm --network none \
  -v "$PWD/assets-src/run:/work/assets-src/run" bunbunny-run-render
node assets-src/run/pack.mjs
```

To iterate on selected assets after a complete render:

```sh
/opt/homebrew/bin/blender -b --factory-startup --python-exit-code 1 \
  --python assets-src/run/render.py -- --only bunny-run,bread-cart --samples 128
node assets-src/run/pack.mjs
```

The Docker invocation accepts the same arguments after the image name and `--`.
Partial renders retain existing metadata for other assets. Do one complete render
before packing. Python and Node sources, final WebPs, manifest, and preview
belong in version control; `.cache/` and `__pycache__/` do not. No `.blend` file
is needed because the scene is reconstructed from source.

## Asset contract

| ID | Frames | Source frame size | Playback |
| --- | ---: | --- | --- |
| `bunny-run` | 8 | 256 × 320 | 14 fps, loop |
| `bunny-jump` | 3 | 256 × 320 | takeoff / airborne / landing |
| `bunny-slide` | 2 | 256 × 320 | enter / hold, 8 fps |
| `bunny-lean` | 2 | 256 × 320 | left / right |
| `bunny-crash` | 3 | 256 × 320 | 8 fps, hold final frame |
| `bread-cart` | 1 | 320 × 320 | static |
| `flour-sacks` | 1 | 288 × 288 | static |
| `shop-awning` | 1 | 384 × 384 | static, overhead obstacle |
| `puddle` | 1 | 320 × 192 | static, ground obstacle |
| `loaf-spin` | 6 | 128 × 128 | 10 fps, loop |
| `paper-bag` | 1 | 192 × 224 | static |
| `coffee-cup` | 1 | 192 × 224 | static |
| `road-stone` | 1 | 768 × 512 | vertical repeat |
| `shops-left`, `shops-right` | 3 each | 256 × 512 | butter / sage / rose variants |
| `sky-dawn` | 1 | 780 × 960 | backdrop |

The manifest uses top-left image coordinates in **source pixels**, untrimmed
frames, row-major sheets (at most 2048 px wide), and `pixelRatio: 2`.
`frameSize`, `frameCount`, `columns`, `rows`, `frames[].rect`, `anchor`,
`frames[].anchor`, `contentBounds`, frame labels, and playback hints are explicit.
Content bounds are for visual inspection/culling, **not collision boxes**.

Use the recorded anchor to place each sprite's projected ground origin. For
example, at nominal size, `s = 0.5`; then apply the game's distance scale:

```js
const s = 0.5 * perspectiveScale;
const { rect: [sx, sy, sw, sh], anchor: [ax, ay] } = asset.frames[frameIndex];
ctx.drawImage(image, sx, sy, sw, sh, x - ax * s, y - ay * s, sw * s, sh * s);
```

The bunny's origin/anchor and camera are constant across actions. The jump
poses have a small expressive tuck/bob; the game supplies actual world jump
height. Lean indices are screen left then screen right. `fps: 0` means select
by game state, not a timer. Playback speeds are presentation hints only, never
inputs to authoritative replay. For reduced motion, choose a representative
static pose; pause animation with the game (D146).

The camera looks along +Y from behind at 36.87° elevation, with +X screen right.
The courier is turned 12° so the bag and silhouette have a gentle three-quarter
read. Obstacles share this camera. Light and material palette are shared.

## Environment tiling

- `road-stone` is an orthographic **ground-plan texture**, intended to be mapped
  into the road trapezoid with the client's Canvas 2D scanline/strip projection.
  It is not a prepainted perspective road and contains no lane markings.
- Shop frames are **camera-plane strips**, with the curb on the road-facing
  side. Repeat vertically, then scale/project the complete repeated strip at
  the road edge. Do not map them as flat ground textures (that flattens roofs).
  Each variant repeats seamlessly with itself. Crossfade entire strips when
  changing the butter/sage/rose palette; differently colored variants are not
  interchangeable edge-to-edge. Left and right are rendered independently so
  the sun direction remains consistent, rather than mirroring the lighting.
- The 3D environment includes neighboring periodic modules to preserve
  occlusion and soft shadows across boundaries. The packer reconciles only
  three edge scanlines to remove stochastic denoising/subpixel differences.
  Environment WebPs are lossless to preserve those exact seam pixels.
- The dawn backdrop has no text or baked UI. At 390 CSS px wide its 780 px
  source supplies 2× coverage; cover/crop to the viewport as needed.

Review `preview.png` at full size and at phone scale. Its English review labels
are outside `public/` and are not game copy. The shipped art contains no text.

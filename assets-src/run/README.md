# Dawn delivery art — R6 / D153

Original procedural Blender models, with no downloaded models/textures/fonts or runtime
3D. The courier now faces straight forward along +Y: the camera sees its back, tail,
kraft bread backpack and upright ears. The street sides are flat front elevations of
continuous bakery, café and flower-shop facades, with warm windows, awnings, lamps and
planters. They have no plinths, ground slabs, isometric roofs or baked street perspective.

`src/lib/run/geometry.json` is shared with engine v3 and the Canvas renderer. Blender
fits obstacle meshes to these front/back/height dimensions and exports ground endpoints
and the physical top reference. The cart is 4400 mm tall; the bunny is 3400 mm (1.294×).

## Docker Blender pipeline

Run from the repository root with Docker and the existing Node dependencies:

```sh
mkdir -p assets-src/run/.cache
BUILDX_CONFIG="$PWD/assets-src/run/.cache/buildx" \
  docker build -t bunbunny-run-render -f assets-src/run/Dockerfile assets-src/run
docker run --rm --network none \
  -v "$PWD:/work:ro" -v "$PWD/assets-src/run:/work/assets-src/run" bunbunny-run-render
node assets-src/run/pack.mjs
# Offline visual QA uses a local-only CPU Canvas dependency; no browser.
npm install --prefix assets-src/run/.cache/preview \
  --cache assets-src/run/.cache/npm --no-package-lock @napi-rs/canvas@1.1.0
npx tsx assets-src/run/preview.ts
```

The optional Docker image uses Debian Blender 4.3.2/Cycles CPU, avoiding the installed
macOS Blender's Metal-discovery crash. The native alternative, where supported:

```sh
BLENDER_USER_CONFIG="$PWD/assets-src/run/.cache/config" \
TMPDIR="$PWD/assets-src/run/.cache/tmp" \
  /opt/homebrew/bin/blender -b --factory-startup --python-exit-code 1 \
  --python assets-src/run/render.py
```

To iterate after a full render, append `-- --only bunny-run,bread-cart --samples 256`
to the Docker command (or native Blender invocation), then rerun pack and preview.
Partial rendering retains metadata for other assets; first perform one complete render.

`render.py` uses Cycles CPU, 256 samples, no denoiser, a fixed seed, warm sun and cool
ambient fill. All assets render at **2× target size**, then `pack.mjs` applies Lanczos3
and WebP quality 92 / alpha quality 100. The stone road uses lossless WebP with matched
periodic edge scanlines. Clay uses AgX +0.6 EV; the dawn gradient uses Standard/sRGB.
Intermediate PNGs, renderer metadata, native Canvas tools and contact sheet stay in the
ignored `.cache/`. Commit source, final WebPs, manifest and `preview.png`, never the cache.
No `.blend` file is needed.

## Asset contract

| ID | Frames | Source frame size | Playback |
| --- | ---: | --- | --- |
| `bunny-run` | 8 | 256 × 320 | 14 fps loop |
| `bunny-jump` | 3 | 256 × 320 | takeoff / airborne / landing |
| `bunny-slide` | 2 | 256 × 320 | enter / hold |
| `bunny-lean` | 2 | 256 × 320 | screen left / right |
| `bunny-crash` | 3 | 256 × 320 | 8 fps, hold final |
| `bread-cart` | 1 | 320 × 320 | static |
| `flour-sacks` | 1 | 288 × 288 | static |
| `shop-awning` | 1 | 384 × 384 | static |
| `puddle` | 1 | 320 × 192 | static |
| `loaf-spin` | 6 | 128 × 128 | 10 fps loop |
| `paper-bag`, `coffee-cup` | 1 each | 192 × 224 | static |
| `road-stone` | 1 | 768 × 512 | ground-plan texture |
| `shops-left`, `shops-right` | 3 each | 600 × 500 | bakery / café / flowers |
| `sky-dawn` | 1 | 780 × 960 | backdrop |

Manifest coordinates are top-left source pixels, row-major untrimmed frames, with
`pixelRatio: 2`, frame rectangles, individual ground anchors, alpha bounds and labels.
`geometry`, `groundFront`, `groundBack`, `heightTop` describe obstacles. Bunny anchors
are the rendered feet baseline; jump world lift comes solely from the engine curve.
Reduced motion selects static poses without stopping essential game movement.

Sprites use an orthographic asset camera at 22.62° elevation, +Y forward, +X right,
zero bunny yaw. This approximates the game's ray elevation at the courier plane.
Shop textures instead use a straight front-elevation camera, with a wall filling every
edge of the 6×5 m tile. Their side is determined by the runtime wall plane, not by a
baked camera angle. Three palettes share cornice/window heights for continuous joins.

## Projection and performance

The game uses one pinhole: `scale = 24000 / (24000 + z)`, with horizon 33%, feet 86%,
camera height 10000 mm. Heights use `height / cameraHeight * screenGroundSpan * scale`.
Obstacle bodies scale with this pinhole, while five continuous source bands separately
map the top, back-ground, origin and front-ground rows to the shared physical geometry.
This keeps D150 contact endpoints without using the depth derivative as the body scale.

The stone road maps by inverse Y projection. Facades map by inverse X projection to
continuous walls parallel to the run direction (x = ±0.49 canvas widths at z=0).
Each facade tile spans 15000 mm along the street and 12500 mm vertically. The three
variants repeat seamlessly in sequence; fractional source coordinates scroll, and wrap
samples split across tile boundaries. No stretched last scanlines or isolated buildings.

Load/resize builds sky/lane layers, projection tables and √2-spaced sprite/texture mip
pyramids. Runtime samples prefiltered textures near their actual destination size,
including horizontal prefiltering for distant facade columns. Columns are one device
pixel wide, and a cached path clips the road edges. DPR is capped at two.
No per-frame canvas filters/shadows, mip creation or source-sheet downscaling.

## Review and validation

`pack.mjs` rejects missing/duplicate frames, clipped sprites (wall elevations intentionally
fill their tile), broken road seams, inconsistent dimensions and assets over **1,500,000
bytes** including manifest. `preview.ts` uses the **actual runtime renderer**, offline in
CPU Canvas, at 320/390 CSS px and DPR 2. It combines both street views and all poses into
`preview.png`, and prints a 240-frame CPU drawing benchmark. Check the back/tail/bag,
lean direction, tile joins, smooth street perspective and bunny/cart size in that image.

Unit tests pin pinhole/inverse projection, top/contact dimensions, actual ground-band
draw endpoints, jump/slide height, cache reuse, mip usage, submission count and pooled
live-state equivalence to server replay. Development `/game/run?fps=1` displays rAF FPS;
no readout is shipped in production. A mid-phone WeChat WebView 60fps playtest remains
necessary; offline CPU timings are not a device FPS claim. No browsers were used for R6.

R6 final shipped total: **462,158 bytes**. Offline CPU drawing: median **1.52 ms**,
p95 **2.67 ms** over 240 frames at 390×650 / DPR 2 (host measurement only).

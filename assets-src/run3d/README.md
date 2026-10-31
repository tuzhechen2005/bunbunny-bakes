# R9 — real-time clay runner assets

Original procedural Blender geometry; no downloaded models, fonts or textures.
This pipeline produces `public/brand/run3d/{bunny,props,town}.glb` and a game-camera
`preview.png`. It does not change the frontend, install runtime packages, or bake
lighting into the GLBs. The materials reuse the warm R6 sprite palette.

## Reproduce without a browser

Run from the repository root with Docker. The base Dockerfile is reused unchanged;
the small R9 layer adds NumPy, required by Debian Blender's glTF exporter.

```sh
mkdir -p assets-src/run3d/.cache
# Skip this first build if the existing R6 image is already available.
BUILDX_CONFIG="$PWD/assets-src/run3d/.cache/buildx" \
  docker build -t bunbunny-run-render -f assets-src/run/Dockerfile assets-src/run
BUILDX_CONFIG="$PWD/assets-src/run3d/.cache/buildx" \
  docker build -t bunbunny-run3d -f assets-src/run3d/Dockerfile assets-src/run3d
docker run --rm --network none \
  -v "$PWD:/work:ro" \
  -v "$PWD/public/brand/run3d:/work/public/brand/run3d" \
  bunbunny-run3d
# Optional Khronos validator, isolated from application dependencies:
npm install --prefix assets-src/run3d/.cache/validator \
  --cache assets-src/run3d/.cache/npm --no-package-lock gltf-validator@2.0.0-dev.3.10
node assets-src/run3d/validate.mjs
docker run --rm --network none --entrypoint blender -v "$PWD:/work:ro" \
  bunbunny-run3d -b --factory-startup --python-exit-code 1 \
  --python assets-src/run3d/validate_poses.py
```

Blender 4.3.2 / Cycles CPU, fixed seed 9, 128 samples, AgX, no denoiser (the Debian
ARM build has no OpenImageDenoise). Preview is 480 × 600, perspective 32 mm lens,
camera at `(0, 4.6, -7.5)` looking at `(0, 1.2, 3)` in exported metre coordinates.
It is behind and above the bunny. The preview imports the exported GLBs, rather
than rendering a separate high-detail model. Lights and camera are preview-only.
Append `-- --preview-only` to the Docker command to rerender the scene from existing GLBs.
Full regeneration replaces only these four output files. `.cache` is ignored.
No `.blend` file is necessary. Identical source/settings reproduce the geometry;
PNG noise and GLB byte ordering can vary between Blender/platform versions.

## Coordinate and scale contract

All exported assets use **metres, +Y up, +Z forward**, with roots at ground centre
and identity transforms. Blender source helpers convert `(x,y,z)` to `(x,-z,y)`;
the standard glTF Y-up exporter performs the final conversion. No runtime axis
correction is needed. Bunny rest feet touch Y=0; total standing height is **1.60 m**.

The engine uses game units: **1 m = 2.125 game units**, so the bunny's standing
height is **3.4 game units**. Apply that uniform scale once to the loaded scene or
instance parent. Keep gameplay collision geometry separate from decorative details.

### Bunny

`bunny.glb` contains `BunnyClay` (3,936 triangles) and one `BunnyRig` armature,
with eight joints and rigid per-part skin weights. The head, ears, arms, legs,
body, tail and bread backpack are all part of one skinned mesh. The two scene roots
are intentional: a root skinned mesh avoids ambiguous inherited transforms in glTF.
Load/transform the **whole glTF scene**, preserving the skeleton. Clone animated
instances with a skeleton-aware clone. Do not extract only the mesh.

| Action | Keys per channel | Duration at 24 fps | Playback |
| --- | ---: | ---: | --- |
| `run` | 25 | 1 s | Loop; opposing legs/arms, body bounce, ear follow-through |
| `jump` | 25 | 1 s | Once; tuck then extend; engine supplies world jump height |
| `slide` | 25 | 1 s | Loop; lowered torso and extended legs; blend in/out |
| `leanL` | 13 | 0.5 s | Once, hold; local -X lean |
| `leanR` | 13 | 0.5 s | Once, hold; local +X lean |
| `crash` | 21 | 0.8333 s | Once, hold; backward tumble |
| `idle` | 49 | 2 s | Loop; subtle breathing |

Loop endpoints match. Per-key ground correction prevents the posed skin from
penetrating the floor; `validate_poses.py` checks every exported animation key after
reimporting the GLB into Blender. Clips contain bone transforms, not world travel or gameplay
collision changes. Run motion is in-place; the engine supplies forward movement.
With a camera behind a +Z-facing character, screen-left is +X; map lane input to
local lean accordingly. Switch to `idle` or a rest pose for reduced motion.

### Props

`props.glb` is a library, **not a pre-laid-out scene**. Its thirteen root nodes all
start at `(0,0,0)`; select or clone a named root and its child mesh.

| Root node | Dimensions / use (metres) |
| --- | --- |
| `cart` | 1.8 wide × 1.4 tall; bread display and striped canopy |
| `flour` | Sack pile, 0.9 tall |
| `awning` | 1.8 wide; underside of hanging valance at Y=1.1; two posts |
| `puddle` | 1.7 × 1.1 footprint, 0.024 tall, glossy opaque blue, no alpha sorting |
| `ramp` | 1.7 wide × 2 long; runs from Y=0 at Z=-1 to Y=1.3 at Z=+1 |
| `van` | 1.9 wide × 6 long; sage; flat walkable roof at Y=1.3 |
| `truck` | Same roof/footprint; rose body, cream headlights and rear lights |
| `bread` | 0.45 wide loaf with flour scores |
| `bag` | Kraft paper bag, bread, folded rim and bakery seal |
| `coffee` | Cream cup, kraft sleeve and brown lid |
| `lamp` | Street lantern, approximately 3.16 tall |
| `tree` | Round clay canopy in a terracotta planter |
| `bench` | 1.6 wide slatted wood seat and back |

Place a ramp with its high end touching the vehicle's rear roof edge. Vehicle
wheels, lights and side emblems stay within the 1.9 × 6 footprint. The roof slab's
central top is planar; its perimeter has a small clay bevel.

### Town

`town.glb` is also a library of overlapping, independent root nodes:
`bakery`, `cafe`, `flower_shop`, `book_shop`, `house_rose`, `house_sage`, `sidewalk`,
and `road`. Each facade has a **6 wide × 7 tall × 4 deep main block**, a roof,
windows, a door, striped awning and sculpted shop/plaque sign. Fronts face +Z;
window frames and awnings project beyond the 4 m shell (maximum depth 4.71 m).
Rotate facades ±90° around Y to face into either side of the street, then repeat
at **6 m intervals along Z**. Align their bases to the sidewalk top (Y=0.18).

`sidewalk` is 2 wide × 6 long, with a 0.18 m curb/paving height. `road` is
8 wide × 6 long, with three lanes and dividers at X=±1.3333. Its base surface
is Y=0; shallow cobbles and lane marks rise to Y=0.024. Both tiles repeat along Z
in exact 6 m steps. The cobble/dash pattern is periodic at the tile boundary;
there are no end caps or unique end markings. Facade shell side faces meet at joins.

## Validation and budget

`validate.mjs` checks binary container integrity, self-contained buffers, no images
or Draco, all root names, bunny height/feet/triangle budget, one skin, exact action
names, run key count, loop endpoints, dimensions and the total delivery budget.
It runs Khronos `gltf-validator` when installed and rejects errors **and warnings**.
The checked-in `validation.json` records measured bounds, counts and validator
results; regenerate it after changing assets.

All materials are simple baseColor/roughness PBR, with zero texture bytes. Water
uses roughness 0.16; clay uses 0.82. There is no Draco, quantization, extension-based
compression, external resource, or runtime decoder requirement. Architecture uses
low-poly hard surfaces while character/prop silhouettes retain rounded geometry.
The budget check includes **all three GLBs plus preview.png**, capped at 1,500,000
bytes. Preview lighting is illustrative; real-time shadows, collision and device
performance are the frontend's responsibility. No browser was used.

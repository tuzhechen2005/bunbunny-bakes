# R12 — sculpted clay-toy runner assets

Original procedural Blender geometry, rebuilt against `public/brand/logo.webp`,
`public/brand/art/menu-run.webp`, `card-run.webp`, and direction A in
`docs/GAME_ART.md`. No downloaded geometry, fonts, generated image textures, or
application changes. All source and delivery changes stay in the two run3d asset
folders.

## Delivered assets

- `bunny.glb`: toast-slice head with a warm crust rim, long splayed pink-lined ears,
  dot eyes, tiny sculpted ω mouth, rosy cheeks, cream body, cocoa apron with straps,
  pocket and buttons, and a folded kraft backpack containing scored bread.
  The toast volumes, body, limbs, ears and apron forms use **applied level-2
  Catmull–Clark subdivision**; geometry has smooth shading and molded bevels.
- `props.glb`: thirteen independent library roots. Rounded delivery vehicles have
  inset windows, wheel arches, tires and hubcaps, door seams, handles, bumpers,
  lamps and sculpted loaf signs. The ramp has individual wooden planks, stringers,
  battens and pegs. Other props have scored loaves, folded paper, turned cup/lamp
  profiles, curved bench supports and clustered foliage.
- `town.glb`: six facade variants with recessed glazing, deep jambs/lintels/sills,
  mullions, flower boxes, scalloped striped awnings, icon signboards, doorsteps,
  shop displays and individual terracotta eave tiles. Sidewalk tiles include
  bevelled curbs and planter boxes. Road cobbles are modeled, staggered, rounded,
  subtly varied in pigment, and repeat with the lane marks.
- `preview.png`: **480 × 600**, imported GLBs in a street, from the existing game
  camera: `(0, 4.6, -7.5)` looking at `(0, 1.2, 3)`, perspective 32 mm. The bunny
  faces forward, away from the camera, in a run pose.
- `bunny-closeup.png`: **512 × 608**, front three-quarter review of the imported
  bunny in its rest pose. Both PNGs use 256-colour palettes to fit the delivery
  budget; this does not change the GLBs or their vertex colours.

`validation.json` is the authoritative byte/count/bounds report. The budget is
**3,500,000 bytes for all three GLBs and both review PNGs combined**.

## Unchanged renderer contract

Authoring helpers map game metres `(x,y,z)` to Blender `(x,-z,y)`; glTF export is
**+Y up, +Z forward**. Scene/library roots have identity transforms and start at
world ground centre. No runtime axis correction or new loader setup is required.

Bunny rest feet touch Y=0 and its nominal standing height remains **1.60 m**.
The existing conversion is **1 m = 2.125 game units**, giving 3.4 game units of
standing height. Gameplay collision geometry remains separate from visual meshes.

### Bunny rig and actions

`BunnyClay` is one skinned mesh with **24,744 triangles**. `BunnyRig` retains the
same eight joints: `body`, `head`, `earL`, `earR`, `legL`, `legR`, `armL`, `armR`.
Rigid part weights retain the clay-toy articulation. These are still two scene
roots: load/transform the **whole glTF scene**, and clone with a skeleton-aware
clone. Do not extract the mesh alone.

| Action | Keys per channel | Duration at 24 fps | Behavior |
| --- | ---: | ---: | --- |
| `run` | 25 | 1 s | Loop; alternating limbs, body bounce, volume-preserving squash/stretch, delayed ear motion |
| `jump` | 25 | 1 s | Once; anticipation squash, extension, tucked legs, ear recoil; engine supplies world jump height |
| `slide` | 25 | 1 s | Loop; lowered, compressed torso, extended legs, raised head and folded ears |
| `leanL` | 13 | 0.5 s | Once, hold; local -X lean with head/ear counterbalance |
| `leanR` | 13 | 0.5 s | Once, hold; local +X lean with head/ear counterbalance |
| `crash` | 21 | 0.8333 s | Once, hold; backward tumble, splayed arms, ear recoil |
| `idle` | 49 | 2 s | Loop; breathing scale, tiny head/ear sway |

All loop endpoints match. Animation stays in place; it contains joint transforms,
not world travel or collision changes. A small ground clearance is applied when
needed at authored keys. `validate_poses.py` reimports the shipped GLB and checks
**every key and every half-key pose** for finite skinning and ground penetration.
Its SHA-256 identifies the exact tested GLB in `validation.json`.

With a camera behind a +Z-facing bunny, screen-left is +X; keep the existing lane
input mapping. Use `idle` or the rest pose for reduced motion.

### Prop roots

Every named root is at the origin and has one child mesh named `<root>Mesh`.
Select or clone the root and its child; the library deliberately overlaps all
props at the origin. Every prop is within **2,000–8,000 triangles**.

| Root | Preserved scale/use |
| --- | --- |
| `cart` | 1.8 m wide × approximately 1.4 m tall, display and striped canopy |
| `flour` | 0.9 m high sack pile |
| `awning` | 1.8 m wide; valance underside near Y=1.1; two posts |
| `puddle` | 1.7 × 1.1 m footprint, 0.024 m high, opaque blue |
| `ramp` | 1.7 m wide × 2 m long; low end Z=-1, high end Z=+1, maximum Y=1.3 |
| `van` | Sage, 1.9 × 6 m footprint, flat central walkable roof at Y=1.3 |
| `truck` | Rose, same footprint and roof height |
| `bread` | 0.45 m wide scored loaf |
| `bag` | Folded kraft bag, bread and round bakery seal |
| `coffee` | Tapered cream cup, kraft sleeve, molded cocoa lid |
| `lamp` | Approximately 3.16 m high |
| `tree` | Rounded foliage in a terracotta planter |
| `bench` | 1.6 m wide, rounded wooden slats and curved supports |

The vehicles intentionally retain the elongated gameplay footprint and low flat
roof. Their decorative wheels, arches, signs and lights stay inside the footprint.
Place the ramp high end against the vehicle's rear roof edge.

### Town roots

The roots remain `bakery`, `cafe`, `flower_shop`, `book_shop`, `house_rose`,
`house_sage`, `sidewalk`, and `road`, each with one `<root>Mesh` child.

Facades have a **6 m wide × 7 m tall × 4 m deep** shell/roof envelope. Details
project from the **+Z front**, up to approximately 2.61 m from the origin. Repeat
at 6 m intervals along Z; rotate ±90° around Y to face into the street and align
bases with the sidewalk's Y=0.18 surface. The six variants have different pigments,
icon signs and shop/window-box arrangements.

`sidewalk` keeps a **2 × 6 m footprint** and **0.18 m walking surface**. Decorative
planters rise above it; they are not a new collision surface. `road` keeps an
**8 × 6 m footprint** and base surface at Y=0. Modeled stones rise to Y=0.012;
lane marks at X=±1.3333 rise to Y=0.024. Both tiles repeat in exact 6 m steps;
staggered cobbles and dashes are periodic, with no end markings.

## Materials, packing and budget

Clay uses PBR base colour and roughness **0.75** (opaque water: **0.22**). Pigment
is baked into `COLOR_0`: darker undersides/recesses, lighter tops, and very subtle
spatial variation. Separate darker recess geometry reinforces depth. There are
**no image textures, external resources, alpha sorting, or baked lighting** in
any GLB.

Neither `gltfpack` nor `gltf-transform` is installed in the available
`bunbunny-run3d` Docker image. Delivery therefore uses **plain glTF 2.0**, with no
Meshopt, Draco, or mesh-quantization extension and **no decoder requirement**.
`pack.py` stores colours as standard normalized RGBA8, stores the exact rigid skin
weights as normalized RGBA8, and shares identical binary streams. Positions,
normals, joints, geometry and every animation sample remain intact. The standard
optional `KHR_materials_specular` extension describes the subdued clay specular
response; it requires no decoder and is supported by the existing GLTFLoader.

## Reproduce and validate

Run from the repository root. Geometry and rendering use Docker Blender **4.3.2**,
NumPy, Cycles CPU, seed 12, 96 samples, AgX and warm studio lighting. The Debian ARM
build has no OpenImageDenoise. PNG packing uses Python/Pillow **11.3.0**. Khronos
validation uses Node and the isolated package below; application dependencies are
not modified.

```sh
mkdir -p assets-src/run3d/.cache
# Only needed when the existing renderer images are absent:
BUILDX_CONFIG="$PWD/assets-src/run3d/.cache/buildx" \
  docker build -t bunbunny-run-render -f assets-src/run/Dockerfile assets-src/run
BUILDX_CONFIG="$PWD/assets-src/run3d/.cache/buildx" \
  docker build -t bunbunny-run3d -f assets-src/run3d/Dockerfile assets-src/run3d

# Generate, pack, then render the ACTUAL packed GLBs.
docker run --rm --network none \
  -v "$PWD:/work:ro" -v "$PWD/public/brand/run3d:/work/public/brand/run3d" \
  bunbunny-run3d -- --models-only
python3 assets-src/run3d/pack.py
docker run --rm --network none \
  -v "$PWD:/work:ro" -v "$PWD/public/brand/run3d:/work/public/brand/run3d" \
  bunbunny-run3d -- --preview-only
python3 assets-src/run3d/optimize_previews.py

# Validate the shipped rig, then structural contracts and the complete budget.
docker run --rm --network none --entrypoint blender -v "$PWD:/work:ro" \
  bunbunny-run3d -b --factory-startup --python-exit-code 1 \
  --python assets-src/run3d/validate_poses.py > assets-src/run3d/.cache/poses.log
npm install --prefix assets-src/run3d/.cache/validator \
  --cache assets-src/run3d/.cache/npm --no-package-lock gltf-validator@2.0.0-dev.3.10
node assets-src/run3d/validate.mjs
```

If Pillow is unavailable, install it in an isolated environment under `.cache`.
`validate.mjs` checks GLB integrity, self-contained buffers, all root names and
identity transforms, scale bounds, triangle budgets, vertex colours, one skin,
seven exact action names, run key count, loop endpoints, matte materials, the
pose-check hash, and all five output files against the 3.5 MB limit. Khronos
validation rejects errors **and warnings**. Geometry and settings are reproducible;
PNG noise and binary ordering can vary by Blender/platform version. Intermediate
renders and logs stay in ignored `.cache/`. No `.blend` file is required.

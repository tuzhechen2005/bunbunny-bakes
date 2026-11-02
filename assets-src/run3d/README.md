# R16 — refined clay runner library

Original procedural Blender geometry, following the warm matte clay palette in
`docs/GAME_ART.md` and the toast bunny identity in `public/brand/logo.webp`.
Changes are confined to `assets-src/run3d/` and `public/brand/run3d/`.
No application code, fonts, image textures, external geometry or commits.

## Delivery

- `bunny.glb`: **27,000 triangles**, one skinned `BunnyClay` mesh, the existing
  eight-joint `BunnyRig`, and all seven existing actions. Adds pocket/bib/hem
  stitching, cheek dimples, tiny eye highlights, brow contours, inner ear folds,
  paw creases and mitten thumb folds. Preserves the toast silhouette, long ears,
  cocoa apron, folded backpack and scored bread.
- `props.glb`: **23 independent named roots**, including all eighteen R15 props
  and `planter`, `bicycle`, `crate_stack`, `menu_board`, `bunting`. Each remains
  within **2,000–8,000 triangles**. Wood has incised pigment grooves, crates and
  carts have pegs, sacks and shoes have stitching, loaves have crust blisters,
  vehicles have grille/wiper/hub details, cups have sleeve ribs, lanterns have
  framed tinted glass, and the newer mechanic props have additional relief.
- `town.glb`: **ten facades**, plus `sidewalk` and `road`. Every facade has
  softened architectural edges, relief brick piers and exposed plaster patches,
  recessed glazing with mullions, open louvered shutters, flower petals/stems,
  six complete tile courses between the eaves, door molding/knobs/keyholes and a
  wall lantern. New storefronts have cakes, cheese wheels and teapots; the corner
  house has a cylindrical bay turret with a conical roof and tile courses.
  The solid facade shell now fills the already documented 4 m depth envelope.
- Road stones have rounded bevels and deterministic **8–12 mm** height variation.
  Sidewalks have individually modeled curb blocks, inset wear and softened caps.

Every mesh has `COLOR_0`. The bake combines per-piece pigment variation, quieter
spatial mottling, darker undersides, lighter tops, and **five short-range BVH
occlusion rays per vertex** for contact/crevice shading. Clay roughness is **0.75**;
opaque puddle pigment remains **0.22**. Lamp glass is opaque sage-tinted clay, so
the assets require no transparency sorting. No textures or external resources.

The authoritative sizes, triangle counts, world bounds, hashes and validation
results are in **`validation.json`**. The limit is **4,000,000 bytes for the entire
`public/brand/run3d/` directory**; source previews are outside that budget.

## Preserved coordinate and animation contract

Authoring maps game metres `(x,y,z)` to Blender `(x,-z,y)`. Exported glTF is
**+Y up, +Z forward**. All library roots have identity translation, rotation and
scale, and their origin remains the original placement anchor. Clone/transform
the named root with its child, not the geometry alone.

**MeshoptDecoder is now required**, as requested for R16. All three GLBs require
`EXT_meshopt_compression` and `KHR_mesh_quantization`. The renderer must register
Three's `MeshoptDecoder` with `GLTFLoader`; that application change is deliberately
outside this assets-only task. Quantization introduces compensating transforms
on the `<root>Mesh` children and compensating inverse bind matrices on the bunny;
the named roots, rendered sizes, world coordinates and action samples are intact.

The bunny's rest feet touch **Y=0**, and standing height remains approximately
**1.60 m**. The existing conversion is **1 m = 2.125 game units**, or 2125 engine
millimetres; standing height is 3.4 game units. Collision geometry is separate.
Load/transform the **whole bunny glTF scene**, which contains `BunnyClay` and
`BunnyRig` as two roots, and use a skeleton-aware clone. Joints remain `body`,
`head`, `earL`, `earR`, `legL`, `legR`, `armL`, `armR`.

| Action | Keys/channel | Duration, 24 fps | Behavior |
| --- | ---: | ---: | --- |
| `run` | 25 | 1 s | Loop; alternating limbs, bounce, squash/stretch, delayed ears |
| `jump` | 25 | 1 s | Once; anticipation, extension, tucked legs, ear recoil |
| `slide` | 25 | 1 s | Loop; lowered torso, extended legs, raised head, folded ears |
| `leanL` | 13 | 0.5 s | Once/hold; local -X lean and counterbalance |
| `leanR` | 13 | 0.5 s | Once/hold; local +X lean and counterbalance |
| `crash` | 21 | 0.8333 s | Once/hold; backward tumble and splayed arms |
| `idle` | 49 | 2 s | Loop; breathing and small head/ear sway |

Actions remain in place: the engine supplies world travel and jump height.
Loop endpoints match. Validation compares every action channel/sample with the
pre-R16 baseline, then reimports the **decoded shipped bytes** in Blender and
evaluates every key and half-key: **335 poses**, finite skinning, no ground
penetration. With a camera behind a +Z-facing bunny, screen-left is +X. Keep the
existing lane mapping; use `idle` or rest for reduced motion.

## Prop roots and anchors

Each named root has exactly one child named `<root>Mesh`. Library models overlap
at the origin by design; select/clone individual roots for scattering.

| Root | Scale / placement |
| --- | --- |
| `cart` | Approximately 1.8 m wide × 1.4 m tall, striped canopy |
| `flour` | 0.9 m high sack pile |
| `awning` | 1.8 m wide; valance underside near Y=1.1 |
| `puddle` | 1.7 × 1.1 m footprint, 0.024 m high, opaque |
| `ramp` | 1.7 m wide × 2 m long; low end Z=-1, high end Z=+1, maximum Y=1.3 |
| `van`, `truck` | 1.9 × 6 m footprint; flat central walkable roof at Y=1.3 |
| `bread` | 0.45 m wide loaf |
| `bag` | Folded kraft bag with bread and bakery seal |
| `coffee` | Cream cup, ribbed kraft sleeve and cocoa lid |
| `lamp` | Approximately 3.16 m high, opaque tinted glass |
| `tree` | Rounded foliage, individual leaves, terracotta planter |
| `bench` | 1.6 m wide, grain grooves and curved supports |
| `pothole` | 1.6 m round footprint, below 0.08 m high, dark opaque overlay |
| `breadwheel` | 1.2 m diameter × 0.48 m thick; axle X, travel +Z; rolling pivot (0,0.6,0) |
| `shoes` | Pair of rose sneakers with sole grooves, laces, heel loops and side stitches |
| `shield` | 0.92 m round sage token, raised bunny emblem, cream beaded rim |
| `signal` | Approximately 0.34 m wide × 0.29 m high; place base at Y=1.3 on truck |
| `planter` | Grounded terracotta box, separate stems/leaves/petals |
| `bicycle` | Grounded bicycle, wheel axle X, front +Z; spokes, pedals and woven basket |
| `crate_stack` | Grounded three-crate stack with grooves, pegs and bread |
| `menu_board` | Grounded wooden A-frame, **blank** cocoa inset on both sides |
| `bunting` | **8 m attachment span** along X; root is the elevated suspension anchor |

`bunting` is the one intentionally airborne library root. Its identity origin is
the midpoint of the attachment line; cord ends are **(-4,0,0), (4,0,0)** in local
metres. Flags and cord sag below that line. Place the root above the street, e.g.
at **Y=5 m**. These coordinates are also stored in the root's `anchor` and
`attachmentEnds` extras. It has no poles and no baked bobbing/animation.

Vehicles retain the elongated gameplay footprint and low flat roof; decorative
features stay within it. Put the ramp's high end against the rear roof edge.
`signal` is independent. `pothole` is a shallow overlay placed at road height,
not a cutout. Pickups remain grounded with no baked travel/bobbing.

## Town roots

Existing: `bakery`, `cafe`, `flower_shop`, `book_shop`, `house_rose`, `house_sage`.
New: **`patisserie`, `cheese_shop`, `tea_house`, `corner_house`**.
Infrastructure: **`sidewalk`, `road`**. Each has one `<root>Mesh` child.

Facades keep the **6 m wide × 7 m tall × 4 m deep shell/roof envelope**. Front
details face +Z and project to approximately Z=2.61. Repeat at 6 m intervals;
rotate ±90° around Y to face the street. Bases sit at sidewalk surface Y=0.18.
`sidewalk` remains **2 × 6 m**, walking surface **Y=0.18**, with decorative
planters above it. `road` remains **8 × 6 m**, base surface Y=0, stones up to
Y=0.012, and lane marks at **X=±1.3333, Y=0.024**. Both tiles repeat in 6 m steps.

## Review images

- `preview.png`, **720 × 900**: final decoded GLBs from the current normal-speed
  game camera in `src/components/run/runThree.ts`: position **(0,4.6,-7.2)**,
  target **(0,1.1,7)**, **55° vertical FOV**. Road X scale is .78; sidewalks and
  facades use the game's offsets. New props/facades are staged for review.
- `bunny-closeup.png`, **760 × 900**: front three-quarter rest-pose portrait.
- `props-review.png`, **1400 × 1150**: all 23 props; van/truck/bunting are shown
  at .48 scale to fit the review grid; all remaining props use their actual scale.
- `facades-review.png`, **1600 × 1000**: all ten variants at equal scale.
- `mechanics-preview.png`: the five mechanic props at actual relative scale.

These are geometry renders, not generated concept art. `review.py` imports
`.cache/decoded/*.glb`, generated by decoding the actual delivery files after
quantization/compression. Camera settings, source SHA-256 hashes and contact-sheet
ordering are recorded in `validation.json`. PNGs retain full colour.

## Reproduce and validate

Blender **4.3.2** in the existing `bunbunny-run3d` Docker image; Cycles CPU,
96 samples, seed 12, AgX, warm area lighting. Build dependencies and intermediate
files stay in ignored `.cache/`; application dependencies are untouched.

```sh
mkdir -p assets-src/run3d/.cache/baseline
# Capture once before overwriting delivery; used to compare the seven actions.
git show HEAD:public/brand/run3d/bunny.glb > assets-src/run3d/.cache/baseline/bunny.glb
npm install --prefix assets-src/run3d/.cache/tools \
  --cache assets-src/run3d/.cache/npm --no-package-lock \
  @gltf-transform/core@4.2.1 @gltf-transform/extensions@4.2.1 \
  @gltf-transform/functions@4.2.1 meshoptimizer@0.24.0 gltf-validator@2.0.0-dev.3.10
docker run --rm --network none -v "$PWD:/work" --entrypoint blender bunbunny-run3d \
  -b --factory-startup --python-exit-code 1 --python assets-src/run3d/refine.py
node assets-src/run3d/compress.mjs
docker run --rm --network none -v "$PWD:/work:ro" \
  -e RUN3D_OUT=/work/assets-src/run3d/.cache/decoded \
  -e RUN3D_COMPRESSED_SOURCE=/work/public/brand/run3d/bunny.glb \
  --entrypoint blender bunbunny-run3d -b --factory-startup --python-exit-code 1 \
  --python assets-src/run3d/validate_poses.py > assets-src/run3d/.cache/poses.log
docker run --rm --network none -v "$PWD:/work" --entrypoint blender bunbunny-run3d \
  -b --factory-startup --python-exit-code 1 --python assets-src/run3d/review.py
docker run --rm --network none -v "$PWD:/work" \
  -e RUN3D_OUT=/work/assets-src/run3d/.cache/decoded \
  --entrypoint blender bunbunny-run3d -b --factory-startup --python-exit-code 1 \
  --python assets-src/run3d/mechanics.py -- --preview
node assets-src/run3d/check-loader.mjs
node assets-src/run3d/validate.mjs
```

Run `node assets-src/run3d/check-loader.mjs` before `validate.mjs` to also test
Three's actual GLTFLoader/MeshoptDecoder and 175 runtime animation poses. It uses
the application's `node_modules/three`; set `RUN3D_THREE_ROOT` to an existing
Three installation when this asset worktree has no application dependencies.

`compress.mjs` merges the original/refined mechanic/scatter libraries while
preserving named roots. Bunny uses **16-bit positions / 12-bit normals** to retain
action precision. Static props use **16-bit positions / 8-bit octahedral normals**;
town uses **14-bit positions / 8-bit octahedral normals**. Colours and weights
remain normalized RGBA8. There is no animation resampling. Town quantization
introduces at most sub-millimetre rounding at the original metre coordinates.
`validate.mjs` checks compressed and decoded GLBs with Khronos validation, rejects
errors/warnings, checks root names/transforms, mesh names, actual world/skin bounds,
triangle bands, material properties, colours, rig/actions, baseline action
samples, pose-test hashes, preview provenance and the entire public byte budget.
Khronos's unsupported-extension informational notice is retained in the report;
the separately decoded validation covers the complete vertex/index buffers.

For a single facade iteration, run `refine.py -- --facade-only patisserie` (or any
other facade root) followed by `compress.mjs town`; the compressed town incorporates
the replacement from `.cache/raw/facades/`. A full `refine.py` build clears these
overrides. `--bunny-only` and `--scatter-only` are also available for iteration.
Use `--town-root road` or `--town-root sidewalk` to rebuild just an infrastructure
tile through the same replacement path.

`render.py` and `mechanics.py` provide the base authoring helpers. R16's supported
entry point is **`refine.py`**. `pack.py`, `append_mechanics.py` and
`optimize_previews.py` are historical R12/R15 tools and are not part of this build;
do not run them on the compressed delivery. No `.blend` file is required.

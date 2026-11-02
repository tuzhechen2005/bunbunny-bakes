# R18c — exported smooth normals within mobile budgets

Original procedural clay assets, optimized for the existing runner. Changes are
limited to this source directory and `public/brand/run3d`; no frontend edits.

`performance.py` rebuilds architecture with one-segment bevels, no subdivision
on boxes, capped sphere/cylinder segments, and simpler swept detail. Road cobbles
retain rounded top outlines but omit buried side/bottom faces. Water is rebuilt with a structured 32 × 32 radial grid, preserving smooth ripple
rings without collapse artifacts in reflections. Remaining static
geometry uses coplanar dissolve with normal/material boundaries, followed by
per-object collapse ceilings. Approved organic props and the skinned bunny use
collapse so their R17 shapes and rig remain the source of truth.

`performance-normals.py` restores geometric normals after topology changes.
Road tops, sidewalk paving and bunting use flat normals; facade bevels and
organic props use welded vertices and freshly averaged smooth normals. Imported custom normals are cleared after reduction. Tree pot and lower-trunk creases over 50° below 0.9 m retain sharp edges; leaves have no angular smoothing cutoff. Normals are explicitly exported through the intermediate glTF round trip. Sidewalk planting is reduced independently,
so the thin paving slabs retain their complete top faces. Colours and skin weights interpolate
through collapse. `performance-pack.mjs` replaces geometry in the original glTF
documents: all node and mesh names, hierarchy, root origins/transforms, materials,
extras, merged-per-material primitives, joints and animation samples are retained.
Replacement geometry is fitted to the original local bounds to preserve placement
anchors and dimensions. Quantization introduces the usual child compensation.

Meshopt compression and the existing normalized attribute layout remain: positions
16-bit (town 14-bit), normals 12-bit for props and bunny (town 8-bit), RGBA8 vertex colours and weights.
The frontend's existing Float32 conversion for geometry transforms remains required;
no loader/application code was changed. Bunny uses medium meshopt level to retain
exact animation sampler values. Static libraries use high level.

## R18b smooth shading correction

Leaf silhouettes retain the approved source geometry, with collapse ceilings raised
to 3,200 triangles per tree. Welding before reduction and again after intermediate
export prevents corner attributes from leaving disconnected shading vertices.
Leaves have no angle-based smoothing cutoff. Rounded planter foliage, flower heads,
loaves and the puddle rim receive the same averaged normals; bunting remains flat.
`check-smooth-normals.mjs` reads the packed GLB through MeshoptDecoder and verifies
that tree normals are not flat and coincident canopy vertices have matching normals. Intentional lower pot/trunk creases are exempt. `validate.mjs` requires NORMAL on every primitive in the packed town/props/bunny GLBs and checks decoded normal counts, finiteness and unit length. `check-loader.mjs` also rejects missing normals or loader-forced flat shading.
The report includes the other rounded props in `review/smooth-normals.json`.

`review/r18b-before/` captures the faceted R18 delivery, while `review/after/`
contains the corrected trees and `props-closeup.png` (planter, bread, bag, crates,
and puddle). `review/before/` retains the original R17 reference.
`review/r18b-triangles.json` compares each prop against the R18 delivery.
Props total 46,423 triangles; the three trees use 3,159 / 3,156 / 3,160.
The props library ceiling is 50,000 triangles.

## Results and review

See `review/triangles.json` for every mesh's before/after triangle count and
`validation.json` for budgets, bounds, hashes, Khronos validation and pose results.
The combined street budget applies to **road + sidewalk**, not each separately.
`review/before/` and `review/after/` contain identical R17 camera views of the street,
trees, puddle and bunny. Each PNG is under 1 MB. The root-level R17 PNGs are historical;
the authoritative R18 previews are under `review/`.

The source topology reduction is not a measured iPhone frame-rate benchmark.
It reduces submitted geometry while preserving the existing material/draw layout.

## Reproduce

Use the existing `bunbunny-run3d` Docker image (Blender 4.3.2) and Node 20+.
All intermediate geometry, tools and logs are ignored under `.cache/`.
Capture the **R17 input** GLBs before running the pipeline; do not recapture the
optimized outputs as the baseline. For this uncommitted R18 worktree, the R17
inputs are also available from `git show HEAD:public/brand/run3d/<name>.glb`.

```sh
mkdir -p assets-src/run3d/.cache/baseline
cp public/brand/run3d/*.glb assets-src/run3d/.cache/baseline/
npm install --prefix assets-src/run3d/.cache/tools \
  --cache assets-src/run3d/.cache/npm --no-package-lock \
  @gltf-transform/core@4.2.1 @gltf-transform/extensions@4.2.1 \
  @gltf-transform/functions@4.2.1 meshoptimizer@0.24.0 \
  gltf-validator@2.0.0-dev.3.10 gl-matrix@3.4.4
node assets-src/run3d/nature-pack.mjs --decode
cp -R assets-src/run3d/.cache/decoded assets-src/run3d/.cache/before-decoded

docker run --rm --network none -v "$PWD:/work" \
  -e RUN3D_REVIEW_DIR=/work/assets-src/run3d/review/before \
  --entrypoint blender bunbunny-run3d -b --factory-startup --python-exit-code 1 \
  --python assets-src/run3d/review.py -- street trees puddle closeup

docker run --rm --network none -v "$PWD:/work" --entrypoint blender bunbunny-run3d \
  -b --factory-startup --python-exit-code 1 --python assets-src/run3d/performance.py
# Separate street export is used as the infrastructure override.
docker run --rm --network none -v "$PWD:/work" --entrypoint blender bunbunny-run3d \
  -b --factory-startup --python-exit-code 1 --python assets-src/run3d/performance.py -- --street-only
docker run --rm --network none -v "$PWD:/work" --entrypoint blender bunbunny-run3d \
  -b --factory-startup --python-exit-code 1 --python assets-src/run3d/performance-normals.py
node assets-src/run3d/performance-pack.mjs

docker run --rm --network none -v "$PWD:/work" \
  -e RUN3D_OUT=/work/assets-src/run3d/.cache/decoded \
  -e RUN3D_COMPRESSED_SOURCE=/work/public/brand/run3d/bunny.glb \
  --entrypoint blender bunbunny-run3d -b --factory-startup --python-exit-code 1 \
  --python assets-src/run3d/validate_poses.py > assets-src/run3d/.cache/poses.log

docker run --rm --network none -v "$PWD:/work" \
  -e RUN3D_REVIEW_DIR=/work/assets-src/run3d/review/after \
  --entrypoint blender bunbunny-run3d -b --factory-startup --python-exit-code 1 \
  --python assets-src/run3d/review.py -- street trees puddle closeup rounded
python3 assets-src/run3d/optimize_previews.py --review
node assets-src/run3d/check-smooth-normals.mjs
node assets-src/run3d/check-loader.mjs
node assets-src/run3d/validate.mjs
npx tsc --noEmit
npx vitest run --configLoader runner --project unit tests/unit/run*
```

Validation preserves the R16/R17 checks for names, transforms, materials, water
concavity/colour, root anchors, finite skinning, sampled actions and compressed and
decoded glTF validity. Obsolete R17 minimum triangle counts and byte-identical bunny
requirements are replaced by R18 ceilings, unchanged animation samples and explicit
checks for all node/mesh names, material properties and primitive counts.

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
Loop endpoints match. Validation checks every action channel/sample against
the captured R17 baseline, then reimports the **decoded shipped bytes** in Blender and
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
| `tree` | Five porous clay leaf clusters, bark, forks and rooted terracotta planter |
| `tree_round2` | Same envelope as `tree`, pale pink blossom accents |
| `tree_tall` | Slender cypress-like crown, same ground anchor and metre units |
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

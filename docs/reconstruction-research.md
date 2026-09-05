# World Forge: Single-Image 3D Reconstruction Research

## Goal

World Forge converts one concept image into an editable Unreal Engine production hypothesis. It must maximize spatial coherence without presenting inferred geometry as survey-grade measurement.

## What current research implies

No single model reliably converts arbitrary fantasy concept art into a complete, metrically correct, game-ready open world. The strongest practical design is a staged system in which each model solves a narrower problem and deterministic code checks the combined result.

### 1. Dense depth and camera priors

- **Depth Pro** predicts sharp zero-shot metric depth and focal length from one image. It is a strong candidate for the canonical depth adapter, but its metric output still needs calibration checks on stylized concept art.
  - Paper: https://arxiv.org/html/2410.02073v2
  - Code: https://github.com/apple/ml-depth-pro
- **Depth Anything** is a strong relative-depth foundation model and useful as a second opinion when metric depth is unreliable.
  - Project: https://depth-anything.github.io/
- **Depth Anything 3** extends the family from monocular relative depth toward spatially consistent any-view geometry with camera estimation. It is the strongest current candidate for upgrading the optional multi-view verifier without forcing users to provide multiple images.
  - Paper: https://arxiv.org/abs/2511.10647
  - Code: https://github.com/ByteDance-Seed/Depth-Anything-3
- **Metric3D v2** jointly addresses metric depth and surface normals and is useful for terrain and facade orientation.
  - Paper: https://arxiv.org/abs/2404.15506

**World Forge decision:** use a depth ensemble rather than trusting one scalar depth result. Depth maps provide relative ordering and surface shape; absolute map scale remains editable unless independently calibrated. Treat DA3/VGGT confidence as model confidence that still needs calibration against correspondences and residuals before it can unlock the 99% measurement gate.

### Implemented dense-depth contract

The analysis service now runs dense depth independently from the two VLM stages:

- The normal path runs `onnx-community/depth-anything-v2-small` locally through Transformers.js/ONNX on CPU. Its relative-depth output is retained with concrete model/runtime provenance and does not require a separately provisioned service.
- `WORLD_FORGE_DEPTH_ENDPOINT` may point to a Depth Pro, Depth Anything, or Metric3D-compatible HTTP adapter. The endpoint receives `{ "imageData": "data:image/..." }` and returns `width`, `height`, and a dense `depth` array. `depthUnit` is `relative` or `meters`. `focalLengthPx`, per-pixel `uncertainty`, and XYZ `normals` are optional; when uncertainty is present, `uncertaintyUnit` must explicitly be `relative` or `meters`.
- `WORLD_FORGE_DEPTH_PROVIDER`, `WORLD_FORGE_DEPTH_MODEL`, and `WORLD_FORGE_DEPTH_VERSION` record explicit provenance for configured adapters.
- When both the configured adapter and local ONNX model fail, the server computes a deterministic per-pixel relative-depth map from decoded image cues. This low-fidelity fallback is deliberately labeled `local-image-cues`; it is not represented as production model evidence and does not drive landmark review decisions.
- Depth, per-pixel uncertainty, and optional normals are stored as little-endian float32 arrays encoded in base64, with dimensions, source units/range, and a SHA-256 checksum. Relative adapters are normalized; metric adapters retain meter values.
- Visual-survey landmark contact points sample the depth map. Each landmark records its sampled depth, depth band, depth-derived uncertainty, visual/heuristic uncertainty, their ratio, and whether both the band and uncertainty agree. A difference above 3× is flagged for review.
- Total adapter failure is non-fatal. The existing visual survey and 3D hypothesis still complete and the failed depth artifact records its reason.

### 2. Visual geometry and camera solving

- **DUSt3R** and **MASt3R** reconstruct dense point maps and camera relations from multiple images without requiring a traditional calibrated SfM setup.
  - DUSt3R: https://github.com/naver/dust3r
- **VGGT** predicts cameras, depth, point maps and tracks from one or more views.
  - Code: https://github.com/facebookresearch/vggt

**World Forge decision:** multi-view geometry is an optional verifier, not a prerequisite. The single-image path always produces an editable hypothesis. When genuine alternate views exist, a geometric solver upgrades specific coordinates and records residuals/provenance.


### Implemented camera-geometry verification contract

The analysis service now has an optional two-stage camera pipeline:

1. `WORLD_FORGE_GEOMETRY_PROPOSAL_ENDPOINT` receives unique canonical and alternate images, their SHA-256 hashes, and a provider name. The provider is `depth-anything-3` by default or `vggt` when `WORLD_FORGE_GEOMETRY_PROPOSAL_PROVIDER=vggt`. It must return camera intrinsics, camera extrinsics, and multi-image point tracks. Model and version provenance are retained.
2. `WORLD_FORGE_COLMAP_ENDPOINT` receives the same images and the complete proposal. It must run COLMAP or pycolmap and return optimized camera intrinsics/extrinsics and 3D point tracks, plus `solver: "colmap" | "pycolmap"` and a concrete `solverVersion`.
3. World Forge does not trust a residual summary returned by either service. The API server validates complete unique camera records, undistorted pinhole intrinsics, SO(3) rotations, camera-center consistency, in-image observations, unique tracks and connected multi-view support. It then reprojects every returned 3D track observation through the optimized camera matrices and computes the residual distribution itself: mean, median, RMS, p95, maximum, and 1px inlier/outlier counts.

The persisted verification artifact contains no image bytes. It stores image hashes, proposal model/version, solver/version, camera intrinsics and extrinsics, point tracks with per-observation server residuals, inlier count, the full residual distribution, and an explicit `serverComputedResiduals` marker.

If either endpoint is absent, times out, returns malformed geometry, omits solver provenance, or cannot yield finite reprojection residuals, verification remains `unavailable` or `failed`. Proposal geometry is retained separately for audit after a valid proposal, but it is never solver evidence. A solve is `rejected` unless it has at least three connected unique images, 12 multi-view inlier tracks, 24 inlier observations, an 80% inlier ratio, and a server-computed mean residual of 1px or less.

### 3. Multi-object scene generation

- **SceneGen** separates objects with masks, combines local asset features with global scene context, and predicts geometry plus relative position. This is closer to World Forge's needs than generating one fused scene mesh.
  - Project: https://mengmouxu.github.io/SceneGen/
- **PixARMesh** and **3D-Fixer** indicate a research trend toward complete scene meshes and in-place completion from one image, but their primary demonstrations do not establish survey-grade outdoor world reconstruction.

**World Forge decision:** maintain a semantic scene graph. Generate reusable object families separately, preserve parent landmark relationships, and instance repeated geometry in Unreal.

### 4. Image-to-3D assets

- **TRELLIS** and **Hunyuan3D** are candidates for selected object-level proxy or hero meshes.
  - TRELLIS: https://github.com/microsoft/TRELLIS
  - Hunyuan3D: https://github.com/Tencent/Hunyuan3D-2
- Managed **Tripo3D** access can provide a practical hosted generation route for individual assets.

**World Forge decision:** image-to-3D generation is not the world-layout solver. It receives a cropped/masked asset, dimensions, modular decomposition and orientation from the scene graph. Terrain, roads and placements remain deterministic/editorial systems.

## 2026 repository and community scan

The implementation guidance below was cross-checked against current project READMEs, GitHub issues/discussions, papers and community reports rather than inferred from demo images alone.

| Project | World Forge role | Decision |
| --- | --- | --- |
| [Depth Anything 3](https://github.com/ByteDance-Seed/Depth-Anything-3) | Any-view depth, camera estimation and optional metric/nested scaling | Build behind a server adapter. Preserve model confidence separately from geometric verification. |
| [VGGT](https://github.com/facebookresearch/vggt) | Fast camera, point-map, depth-map and point-track proposal | Use as a proposal/verifier stage; recompute residuals server-side before raising confidence. |
| [COLMAP](https://github.com/colmap/colmap) / [pycolmap](https://github.com/colmap/pycolmap) | Feature matching, two-view verification, bundle adjustment, inliers and reprojection residuals | Treat as the geometric authority when genuine overlapping views exist. It still cannot recover absolute scale without an external metric constraint. |
| [Nerfstudio](https://github.com/nerfstudio-project/nerfstudio) | Inspect and render a solved capture after camera validation | Optional downstream renderer, not a confidence source. |
| [Open3D](https://www.open3d.org/docs/release/tutorial/reconstruction_system/index.html) | RGB-D registration, point-cloud filtering and reconstruction inspection | Useful after depth/camera calibration; not a substitute for same-scene correspondence checks. |
| DUSt3R / MASt3R | Dense matching and pose proposals for weak-texture scenes | Keep as fallback research adapters; validate licensing and runtime packaging before production adoption. |

Community and issue-tracker lessons:

- Calibrated intrinsics do not remove Structure-from-Motion scale ambiguity. Metric scale needs a measured baseline, known distance, GPS/range evidence, or a separately justified metric-depth prior.
- A visually plausible dense mesh can coexist with wrong camera poses. Confidence must use inlier counts and residual distributions, not screenshots or a single RMS claim.
- Monocular depth used for pose estimation has affine scale/shift ambiguity. World Forge therefore uses it as ordinal evidence until a solver and calibration establish metric scale.
- Outdoor fantasy concept art has weak/repeated textures and non-physical perspective. Classic SfM can fail; failure must remain explicit rather than silently turning generated alternate views into evidence.

Implementation consequence: depth artifacts are tied to their canonical input hash, unavailable measurements remain null rather than fake zeros, and the visual survey is audited for unique IDs, normalized geometry and lossless synthesis linkage.

### Implemented alternate-view registration

World Forge now performs a local server-side overlap check before treating uploaded files as additional scene views:

- OpenCV.js/WASM detects ORB keypoints and binary descriptors.
- A 0.75 nearest-neighbor ratio test rejects ambiguous matches.
- RANSAC estimates a homography with a 3px threshold.
- Each alternate records image hash, keypoint counts, candidate matches, inliers, inlier ratio, homography and server-computed reprojection RMS.
- Registration requires at least 24 inliers, a 0.35 inlier ratio and RMS no greater than 3px.
- Confidence view counts use registered views rather than uploaded-file counts.

This stage verifies same-scene overlap only. A homography does not recover metric camera pose for a non-planar world, so it cannot set `cameraPoseVerified`, switch reconstruction to multi-view verified, or unlock the 99% gate. A future DA3/VGGT/COLMAP adapter must add intrinsics, extrinsics, 3D tracks and independently recomputed epipolar/bundle-adjustment residuals.

## Production pipeline

1. **Visual survey**
   - Detect horizon and vanishing directions.
   - Produce normalized object boxes, contact points and visible-part evidence.
   - Build foreground/midground/background/distant depth bands.
   - Build an occlusion graph and terrain/water contours.
2. **3D hypothesis**
   - Fit one coherent perspective-camera hypothesis.
   - Convert depth ordering and visible ratios into editable XYZ ranges.
   - Continue hidden terrain using conservative slope envelopes.
   - Preserve uncertainty per landmark and placement.
3. **Semantic asset graph**
   - Split terrain, architecture, props, effects and repeated families.
   - Separate unique production meshes from world instances.
   - Decompose enterable hero buildings into foundations, floors, walls, openings, roofs and interiors.
4. **Optional geometric verification**
   - Use genuine alternate views with VGGT/DUSt3R-class solvers.
   - Store camera poses, image hashes, correspondences and reprojection residuals.
   - Upgrade only evidence-supported confidence components.
5. **Asset generation**
   - Generate selected masked objects with TRELLIS/Hunyuan3D/Tripo3D-class providers.
   - Validate scale, pivots, collision, topology and modular seams before Unreal replacement.
6. **Unreal blockout**
   - Export landscape/heightfield, spline roads and coastlines, landmark proxies and instance transforms.
   - Keep source units in meters and convert explicitly to Unreal centimeters.

## Confidence policy

- “Reconstruction confidence” means internal coherence of the production hypothesis.
- It is not physical measurement accuracy.
- A single image may achieve high visual coverage and spatial consistency, but cannot prove hidden backsides, absolute scale or camera pose.
- A 99% measurement claim requires a verified solve artifact, not user-entered RMS or duplicated images.
- The 99% gate reads only the server-computed residual distribution in the persisted camera verification artifact. The request's `reprojectionErrorPixels` is retained solely as `claimedReprojectionErrorPixels` for audit and can never unlock the gate.
- Deterministic XYZ distance calculations can be exact relative to the chosen coordinates while those coordinates remain uncertain.

## Next implementation priorities

1. Persist the full visual survey output instead of using it only inside the analysis request.
2. Add normalized 2D evidence and occlusion relationships to every landmark.
3. Export an Unreal blockout script that spawns proxy actors and landscape/spline guides, not only a manifest.
4. Add an optional object-level Tripo3D adapter after the spatial pipeline is stable.

# World Forge — Math-First ~99% Confidence Plan

**Generated:** 2026-09-06 ~01:30 Europe/Istanbul  
**Repo root (user PC):** `C:\Users\Asus\Desktop\Forge`  
**Intent clarified:** *"confidence proxy olmadan %99"* = no fake/inflated confidence. Only mathematical evidence unlocks `target-met`. Weighted VLM/heuristic scores may approach 99% but must never be forced there.

**Product truth (unchanged):** Concept art → editable Unreal **hypothesis** (meters internally → cm at export). Not survey-grade. Multi-view + COLMAP upgrades measurement claims.

---

## Conflict note (P0 already changed on disk)

`docs/PERFECTING_BACKLOG.md` (mtime ~01:08 TRT) is **partially stale**. As of deep-read ~01:19–01:25 TRT these already exist / are wired:

| Item | Disk state |
|------|------------|
| `artifacts/api-server/src/lib/evidence-gates.ts` | **EXISTS** (`computeExportReadiness`, tiers draft/verified/scale-locked) |
| `GET …/export` cm gate | Uses `computeExportReadiness`; `?draft=1` for unscaled |
| Agent `exportAgentProject` / `reviewAgentConfidence` | Gated on `exportReadyCm`; returns tier + failingChecks |
| `unreal-export.ts` draft metadata | `units=arbitrary; pose=unsolved; exportTier` |
| `PATCH` status→ready | Blocked without `hasCompletedAnalysis` |
| `enrichAnalysis` syncs `geometryVerification.cameraPoseVerified` | Set from `isVerifiedCameraGeometry(...)` |

**Do not re-implement those blindly.** Next work must remove remaining proxies and finish UI + endpoint path.

---

## A) Exact current blockers to REAL 99%

### A1. Confidence proxies / inflation (must die)

In `projects.ts` `enrichAnalysis` (~L491–516):

1. **Hard boost:** when `hasPixelCalibration && hasGeometricValidation`, overall becomes `Math.max(0.99, weighted)` — this is the primary anti-intent hack.
2. **Ceiling jump:** same gate sets `ceiling = 0.995` instead of the evidence-derived ceiling.
3. **Asset confidence pad:** assets default to `min(0.99, analysis.confidence - 0.04)` — cosmetic, not gate-breaking, but still a soft ceiling.

**Math-first rule:** `target-met` requires **boolean evidence conjunction** AND `weighted >= 0.99` **without** `Math.max(0.99, …)`. If weighted is 0.94 after real geometry, status stays non-target and UI shows 94%.

### A2. Env endpoints (hard geometric wall)

Without these, `runCameraGeometryVerification` returns `unavailable` / proposal-only → `isVerifiedCameraGeometry` is forever false → `target-met` unreachable:

| Env | Role | Timeout in code |
|-----|------|-----------------|
| `WORLD_FORGE_GEOMETRY_PROPOSAL_ENDPOINT` | DA3 Nested / VGGT proposal (intrinsics, extrinsics, tracks) | 30s |
| `WORLD_FORGE_GEOMETRY_PROPOSAL_PROVIDER` | `depth-anything-3` (default) or `vggt` | — |
| `WORLD_FORGE_COLMAP_ENDPOINT` | COLMAP/pycolmap verify + refine | 60s |
| `WORLD_FORGE_DEPTH_ENDPOINT` (optional) | Metric/relative dense depth | 20s |

**Blocking 99% without COLMAP endpoints:** YES — by design. Homography ORB registration (`geometry-verifier.ts`) explicitly never sets pose; notes say 99% stays locked until a camera solver. Nested DA3 metric depth alone is **proposal**, not evidence, until COLMAP residuals are server-recomputed.

### A3. Server gates that correctly keep 99% locked

From `camera-geometry.ts` / `isVerifiedCameraGeometry`:

- ≥3 unique same-scene images with intrinsics + extrinsics + residualled observations
- Server-computed residuals (`serverComputedResiduals === true`)
- Mean residual ≤ **1.0 px**; inlier threshold 1 px
- ≥12 verified tracks; ≥24 inliers; inlier ratio ≥ 0.8
- Image graph connected via inlier tracks
- Non-degenerate baselines (min baseline/scene diameter ≥ 0.005)
- Median triangulation angle ≥ 1°
- Undistorted PINHOLE only; SO(3) rotations; center consistent with R,t

COLMAP-aligned practice (research): two-view RANSAC defaults `min_num_inliers=15`, `max_error≈4px`, `confidence=0.999`; global mapper tightens to `max_error=1.0`, `min_num_inliers=30`. World Forge’s **1 px mean** gate is intentionally stricter than default COLMAP verification — keep it; do not loosen to “feel” 99%.

### A4. UI lies / soft lies (still present)

| UI surface | Lie / mismatch |
|------------|----------------|
| `button-export-project` | Always enabled; no tier badge; generic error ignores `EXPORT_NOT_SCALE_LOCKED` / `failingChecks` |
| `ExportDialog` | Kicker “Export bundle / **Unreal ready**” even for draft/`units=arbitrary` |
| `CalibrationEvidencePanel` | Treats **user-typed** RMS ≤1 as “validated”; ignores `cameraGeometryVerification.residualDistribution` |
| `GeometryVerificationPanel` | Shows ORB registration only; **no COLMAP residual panel** |
| `ProductionHandoffPanel` | Uses synced `cameraPoseVerified` (OK if re-analyzed) but no Draft→Verified→Scale-locked machine |
| Spatial Read “X% Match” | Displays overall confidence as “Match” — easy to misread as photogrammetry grade |
| `saveSettings` | Still PATCHes `status: 'ready'` (server now rejects if no analysis; still conflates “saved” with “ready”) |

### A5. Scale vs pose

Metric scale for `scale-locked` today = user `knownScaleMeters > 0` AND `knownScalePixelDistance >= 10` (`hasMetricScale` in evidence-gates). That is **necessary but not sufficient** for true metric reconstruction:

- COLMAP pose is up-to-scale until a metric prior is applied.
- Nested DA3 (`DA3NESTED-GIANT-LARGE`) outputs metric meters; monocular `DA3METRIC-LARGE` uses `metric_depth = focal * net_output / 300`.
- Math-first path should **scale-lock** by aligning COLMAP reconstruction to (a) known length in pixels OR (b) metric depth median scale against sparse tracks — then recompute residuals in that frame. User-typed meters alone must not unlock 99% without pose verification (already true); pose alone must not unlock cm export without scale (already true in evidence-gates).

---

## B) Minimal code changes ordered by ROI (math-first)

### ROI-1 — Kill confidence inflation (api, ~15 LOC) ★★★★★

**File:** `artifacts/api-server/src/routes/projects.ts` (`enrichAnalysis`)

- Delete `Math.max(0.99, weighted)`.
- Keep `ceiling` as **evidenceCeiling only** (cap ≤ 0.98 without geometry+scale; with geometry+scale allow up to 1.0 but do not force).
- `status === "target-met"` iff:
  - `hasPixelCalibration`
  - `hasGeometricValidation`
  - `!hasDepthReview`
  - `weighted >= 0.99` **naturally**
- Optionally add `confidenceBreakdown.forcedBoostApplied: false` audit field (or omit forever).

### ROI-2 — Wire UI to `computeExportReadiness` tiers (ui, medium) ★★★★★

**File:** `artifacts/world-forge/src/pages/workspace.tsx`

- Expose readiness on project summary or derive client-side from analysis fields mirroring evidence-gates.
- Export CTA:
  - **Scale-locked:** primary “Export Unreal cm”
  - **Verified / Draft:** secondary “Export draft (arbitrary units)” → `?draft=1`
  - Surface `failingChecks` in error toast (`camera-geometry-unverified`, `metric-scale-unknown`).
- ExportDialog reads `exportMetadata.exportTier` / `units` / `pose` and never says “ready cm” for draft.

### ROI-3 — Server residual panel + kill typed-RMS “validated” (ui, small) ★★★★☆

**File:** `workspace.tsx` `CalibrationEvidencePanel` / new `CameraGeometryPanel`

- Prefer `analysis.cameraGeometryVerification.residualDistribution.{mean,median,rms,p95,inlierCount}`.
- Typed RMS stays audit-only (already noted in enrichAnalysis).
- Show proposal provider + COLMAP solver version + unavailable reason when endpoints missing.

### ROI-4 — Stand up local proposal + COLMAP adapters (ops/infra) ★★★★☆

Without this, ROI-1–3 only make honesty faster — they cannot reach 99%.

Minimal local services:

1. **Proposal:** Depth Anything 3 Nested (or VGGT) HTTP adapter returning `cameraIntrinsics`, `cameraExtrinsics`, `pointTracks` matching `parseGeometryPayload`.
2. **Verifier:** COLMAP/pycolmap HTTP adapter that returns solver id/version + refined geometry; Node recomputes residuals (already implemented).

Suggested gates at adapter boundary (map to COLMAP practice):

- Feature match geometric verify: max_error ≤ 4 px interim; final BA mean residual must pass WF 1 px.
- Reject if <3 registered images or baseline degenerate (server already checks).

### ROI-5 — Metric scale lock from nested depth ∪ known length (api, medium) ★★★☆☆

**Files:** `depth-adapter.ts`, `camera-geometry.ts` / new `scale-lock.ts`, `enrichAnalysis`

- If depth `depthUnit === "meters"`, estimate scale `s` aligning triangulated depths to metric depth at track projections (RANSAC scale; cite Murre/M2Depth style SfM↔mono alignment).
- Cross-check against `knownScaleMeters / knownScalePixelDistance` when both present; disagree → `review-required`, no target-met.
- Cache scale factor on analysis (`scaleLock: { method, factor, inlierRatio }`).

### ROI-6 — Multi-angle human approval state machine (api+ui) ★★★☆☆

See section C. Persist `approvalState` separately from project `status`.

### ROI-7 — Pipeline speed (see D) ★★☆☆☆

Parallelism + skip VLM synthesis when only geometry re-verify needed.

### ROI-8 — Alternate↔alternate registration graph (≥3 views) ★★☆☆☆

P2 from backlog; improves registration robustness, not 99% unlock alone.

### Explicit non-goals for this track

- Do not loosen residual thresholds to hit 99%.
- Do not let VLM `confidence` field from OpenAI influence overall (already overwritten by enrichAnalysis — keep it that way).
- Do not treat ORB homography RMS as pose evidence.

---

## C) Multi-angle approval state machine

### States

```
Draft → Verified → Scale-locked
         ↑            ↑
         └── reject ──┘ (back to Draft or Verified)
```

| State | Machine meaning | Evidence required | Export |
|-------|-----------------|-------------------|--------|
| **Draft** | Hypothesis world | Analysis complete; pose unsolved and/or scale unknown | Draft GLB/JSON only (`units=arbitrary`, `pose=unsolved`) |
| **Verified** | Multi-view pose solved | `isVerifiedCameraGeometry` true; human confirms views depict same scene | Draft OK; **cm blocked** |
| **Scale-locked** | Metric + verified | Verified + `hasMetricScale` (+ optional nested-depth scale consensus) + human confirms measured length | **Unreal cm** enabled |

Human approval is **conjunctive**, not a confidence substitute:

- Cannot approve Scale-locked if gates fail.
- Can refuse Scale-locked even if gates pass (operator distrust) → stay Verified; cm export stays off until approve.

### Mapping to UI screens

| Screen / panel | Draft | Verified | Scale-locked |
|----------------|-------|----------|--------------|
| MultiViewGuidePanel | Required CTA: capture 3 angles | Show registered checkmarks | Locked summary |
| GeometryVerificationPanel (ORB) | Show rejects/duplicates | ≥2 alternates registered | Same |
| **New** CameraGeometry / COLMAP panel | “Endpoints missing / unavailable” | Residuals, baselines, track counts | Green gate strip |
| CalibrationEvidencePanel | Collect known length + px span | Length claimed | Length confirmed + scale-lock method |
| ConfidenceBanner | status `needs-more-views` / `needs-calibration`; show **honest %** | status may be `review-required` if weighted < 0.99 | `target-met` only if weighted ≥ 0.99 **and** approvals |
| ProductionHandoffPanel | Next: add views | Next: measure scale + approve pose | Next: Export Unreal cm |
| Export button | “Export draft…” | “Export draft…” + disabled cm | “Export Unreal cm” |
| ExportDialog | Banner: arbitrary units | Banner: pose verified, scale pending | Banner: meters→cm ×100 |

### Suggested API shape (minimal)

```ts
approval: {
  poseApprovedAt: string | null;      // human Verified
  scaleApprovedAt: string | null;     // human Scale-locked
  approvedBy: string | null;
  notes: string | null;
}
```

`computeExportReadiness` extension: `exportReadyCm = cameraGeometryVerified && metricScaleKnown && scaleApprovedAt != null` (optional strict mode; ship boolean feature flag `WORLD_FORGE_REQUIRE_HUMAN_SCALE_APPROVAL=1`).

---

## D) How to make the pipeline fast

Current analysis order (`POST …/analysis`):

1. Start `generateDenseDepth` ∥ `verifyImageGeometry` (ORB)
2. Await ORB → trust-filter references
3. Start `runCameraGeometryVerification` (proposal+COLMAP)
4. **Await VLM survey** (serial, slow)
5. Await denseDepth ∥ cameraGeometry
6. **Await VLM 3D synthesis** (serial, slowest)
7. Optional VLM retry
8. attach survey/depth/audit → `enrichAnalysis` → `status=ready`

### Parallelize

| Work | Parallel with |
|------|----------------|
| Dense depth | ORB + camera solve + VLM survey |
| Camera proposal+COLMAP | VLM survey (already partially: started before survey, joined after) |
| Depth preview PNG | After dense depth, parallel to synthesis |
| Persist analyzing status | Fire-and-forget already |

**Improve:** start camera solve **immediately** with all uploaded hashes, then **re-filter** to trusted set if ORB rejects — or run ORB first only for trust filter (current), but do **not** wait for VLM before joining geometry (already OK). Biggest win: **do not block geometry on VLM**.

### Cache

| Key | Value |
|-----|-------|
| `sha256(image)` | DenseDepthArtifact |
| `sha256(canonical)+sorted(alt hashes)` | GeometryVerification (ORB) |
| Same + endpoint versions | CameraGeometryVerification |
| Survey raw JSON hash | Skip re-survey if images+calibration unchanged (“re-verify geometry only” mode) |

### Skip / degrade when VLM slow

1. **Geometry-only reanalyze** endpoint: ORB + COLMAP + enrichAnalysis using **previous** survey/landmarks; no OpenAI.
2. **Draft-fast path:** if no OpenAI key / timeout → seed analysis + depth + registration; status ready-draft; confidence capped.
3. Cap survey tokens; keep synthesis as optional second stage (“Enhance production tree”).
4. Local ONNX depth already falls back; prefer configured metric endpoint when aiming for scale-lock.

### Export path latency

`buildUnrealExportBundle` is pure CPU (heightmap R16 + script). Keep cm conversion **exactly** `×100` at boundary (`unreal-export.ts`); no resampling tricks. Cache last bundle path on project when analysis hash unchanged.

---

## E) Test matrix

### Unit (node:test / existing style)

| Test | Assert |
|------|--------|
| `enrichAnalysis` no boost | With fake verified geometry + scale, if weighted mocked < 0.99 → status ≠ `target-met`, confidence < 0.99 |
| `enrichAnalysis` natural 99 | Construct evidence weights ≥ 0.99 + gates → `target-met` |
| `isVerifiedCameraGeometry` | Existing zero-baseline reject / separated accept (evidence-gates.test.ts) |
| `computeExportReadiness` | incomplete → draft/no export; pose only → verified; pose+scale → scale-locked |
| Export route | Without scale-lock → 409 unless `?draft=1`; draft metadata `units=arbitrary` |
| PATCH ready | Without analysis → 409 `ANALYSIS_REQUIRED` |
| Depth metric sample | `depthUnit=meters` sampling returns meters not map-normalized fiction |
| Scale-lock RANSAC (when added) | Outlier depths rejected; disagree with known length → review-required |

### Local manual checklist

1. Single image, no endpoints → confidence ≪ 99%, status `needs-more-views`, Export cm 409, draft export OK with arbitrary units.
2. Three near-duplicate images → perceptual reject; views don’t count.
3. Three real angles, no COLMAP env → ORB may register; COLMAP panel unavailable; still no 99%.
4. With proposal+COLMAP env, three angles, residual fail → `rejected`, no 99%.
5. Residuals pass, no known scale → tier `verified`, cm blocked, human Verified approve allowed.
6. Add known length + px≥10 (+ optional human scale approve) → `scale-locked`; Export cm; Unreal script places cm = m×100.
7. Typed RMS = 0.1 alone never flips CalibrationEvidencePanel to validated without server distribution.
8. UI never shows “Unreal ready” on draft bundle.
9. VLM timeout → geometry-only path still updates camera artifact.

---

## F) What still needs OpenAI vs pure geometry

| Capability | OpenAI (VLM) | Pure geometry / local |
|------------|--------------|------------------------|
| Object inventory, layers, assetTree, Rodin instructions | **Required** (today) | Not available without alternate model |
| Visual survey bboxes / occlusion / waterlines | **Required** | Could later swap to detector; not blocking 99% math |
| Landmark XYZ hypothesis from concept | **Required** for production tree | Geometry can constrain/refine after pose exists |
| ORB registration | — | **Pure** (`geometry-verifier.ts`) |
| Camera pose + residual gates | — | **Pure** (proposal net + COLMAP + Node residuals) |
| Dense depth | Optional cloud | Local ONNX / cues / `WORLD_FORGE_DEPTH_ENDPOINT` |
| Confidence overall / target-met | Must **ignore** VLM confidence number | **Pure** enrichAnalysis evidence |
| Unreal cm export transforms | — | **Pure** ×100 |
| Human multi-angle approval | — | **Pure** product state |

**99% is a geometry+scale predicate**, not an LLM judgment. OpenAI remains necessary for **editable world content**, unnecessary for **unlocking target-met**.

---

## Research anchors (short)

- **DA3 Nested:** any-view giant + metric large → metric-scale geometry proposal; nested output already meters; monocular metric uses `focal * output / 300`.
- **Multi-view confidence:** prefer geometric cross-view consistency (reprojection / depth disagreement) over network softmax; hybrid deep×geometric confidence (ICCV MVS solvers) — WF should stay on **reprojection inliers**.
- **Scale alignment:** RANSAC scale(/shift) between SfM sparse depth and metric mono depth (Murre / M2Depth-style) before claiming scale-locked.
- **COLMAP gates:** verify matches with RANSAC; final accept only after BA residuals meet WF’s 1 px mean + multi-view support graph.

---

## Implementation sequence (suggested PR slices)

1. **PR-math:** remove `Math.max(0.99,…)`, ceiling honesty, unit tests for non-inflation.
2. **PR-ui-tiers:** Export CTA + dialog + CalibrationEvidencePanel server residuals + COLMAP panel stub.
3. **PR-approval:** Draft→Verified→Scale-locked persistence + optional human approve flags.
4. **PR-adapters:** local Docker/HTTP for `GEOMETRY_PROPOSAL` + `COLMAP` + sample compose file.
5. **PR-scale-lock:** nested metric ↔ COLMAP scale consensus.
6. **PR-fast:** geometry-only reanalyze + caches.

---

## Top 5 ROI changes (executive)

1. Remove `Math.max(0.99, weighted)` / ceiling force in `enrichAnalysis`.
2. Finish UI honesty: tiered Export + server residuals (stop typed-RMS “validated”).
3. Run `WORLD_FORGE_GEOMETRY_PROPOSAL_ENDPOINT` + `WORLD_FORGE_COLMAP_ENDPOINT` locally — **without these, real 99% is impossible**.
4. Human Draft→Verified→Scale-locked mapped to existing panels + cm export only on Scale-locked.
5. Metric scale-lock (known length ∪ nested DA3 meters) with residual recompute — then natural weighted ≥ 0.99 can unlock `target-met`.

---

## Blocking 99% without COLMAP endpoints?

**Yes.** Proposal nets (DA3 Nested / VGGT) are hypotheses. World Forge only treats geometry as evidence after COLMAP/pycolmap + **server-side** residual recompute passes the three-view / baseline / 1 px gates. Homography registration cannot substitute. Ship honest Draft forever rather than fake 99%.

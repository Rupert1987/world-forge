# World Forge — Perfecting Backlog
Generated: 2026-09-06 (Europe/Istanbul). Source: local deep-read of Desktop\Forge. No secrets.

## Product truth
Concept art → editable Unreal **hypothesis** (meters internally → cm at export). Not survey-grade. Multi-view + COLMAP upgrades measurement claims.

## P0 — ship blockers (no OpenAI key required)

### 1. Export ignores unsolved camera
Today READY + Export unlock with no pose/confidence check.
- Session `GET /export`: project exists only
- Agent `exportAgentProject` / `reviewAgentConfidence.exportReady`: `status === "ready"` only
- Workspace Export button: always enabled
- Analysis success always sets `status = "ready"`

**Fix:** Three tiers — Draft (mono / soft mesh, draft GLB OK) → Verified (pose solved + multi-view) → Scale-locked (metric + verified). Only Scale-locked enables Unreal cm. Stamp draft metadata `units=arbitrary; pose=unsolved`.

Touch: `artifacts/api-server/src/routes/projects.ts`, agent export paths, `artifacts/world-forge` Export CTA / handoff panels.

### 2. UI pose gate wired to wrong artifact
`geometryVerification.cameraPoseVerified` is hard-coded **false** in `geometry-verifier.ts` (ORB homography ≠ pose). Real gate: `cameraGeometryVerification.status === "verified"` via `isVerifiedCameraGeometry` (≥3 views, COLMAP, residuals ≤1px, inlier thresholds).

**Fix:** `ProductionHandoffPanel` / `GeometryVerificationPanel` read `analysis.cameraGeometryVerification`. Sync `cameraPoseVerified` after enrich on analysis success. Surface COLMAP panel (today only ORB registration shown).

Touch: `workspace.tsx`, `geometry-verifier.ts`, `projects.ts` post-`enrichAnalysis`.

### 3. Fake READY via settings PATCH
`saveSettings` can PATCH `status: 'ready'` without re-analysis.

**Fix:** Block status→ready unless analysis completed; harden `PATCH /projects`.

### 4. Auth docs ≠ runtime
Runtime (`api-auth.ts`) accepts **Bearer and X-API-Key**. OpenAPI + Developer UI examples = Bearer only. Private Replit steals Bearer → use `X-API-Key`.

**Fix:** Dual securitySchemes in OpenAPI; Developer/MCP examples show `X-API-Key` first for proxy/private deploy.

---

## P1

5. **CalibrationEvidencePanel** — use server residual distribution, not typed user RMS / local file count.
6. **Dedupe** alternate `objectPaths` on agent attach (`agent-service.ts:storeAgentImage`).
7. Sync dual geometry artifacts so agents are not confused (`solver-verified` never set today).
8. Soft-gate Export UI when confidence ≠ `target-met` (warn/confirm).

## P2

9. Alternate↔alternate registration graph when ≥3 views (`verifyImageGeometry`).
10. Extract `evidence-gates.ts` from `enrichAnalysis` + `isVerifiedCameraGeometry` (tests already named `evidence-gates.test.ts`; **no** `evidence-gates.ts` module today — gates live in `camera-geometry.ts` + `projects.ts:enrichAnalysis`).

---

## Confidence formula (context)
Weights in `enrichAnalysis`: visualDetection 0.27, scaleCalibration 0.20, depthInference 0.20, coverageCompleteness 0.16, spatialConsistency 0.17.
99% / target-met needs knownScale + pixel span≥10 + verified camera geometry + no landmark depth `review-required`.
User-claimed reprojection RMS is audit-only — cannot unlock 99%.

## Env for real pose (optional upgrade)
`WORLD_FORGE_GEOMETRY_PROPOSAL_ENDPOINT` + `WORLD_FORGE_COLMAP_ENDPOINT` — absent → forever hypothesis (OK if export tiered).

## Pipeline (ordered)
upload → dense depth + ORB registration → trust filter → optional camera solve → VLM survey → VLM 3D synthesis → attach depth/survey/audit → enrichAnalysis → ready → `buildUnrealExportBundle`.

## Cloud Agent note
Repo: https://github.com/Rupert1987/world-forge (private). Cursor Cloud Agent could not access it from this session — apply P0 via PR when GitHub app has access, or implement locally.

## Suggested PR title
`fix: gate Unreal cm export on scale-locked camera pose + align X-API-Key docs`

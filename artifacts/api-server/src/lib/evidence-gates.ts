import {
  isVerifiedCameraGeometry,
  type CameraGeometryVerification,
} from "./camera-geometry";

export type ExportReadinessTier = "draft" | "verified" | "scale-locked";

export type ExportReadiness = {
  tier: ExportReadinessTier;
  /** Full Unreal cm export is allowed only for scale-locked. */
  exportReadyCm: boolean;
  /** Soft/draft hypothesis export is allowed when analysis exists. */
  exportReadyDraft: boolean;
  /** Back-compat alias for exportReadyCm. */
  exportReady: boolean;
  failingChecks: string[];
  cameraGeometryVerified: boolean;
  metricScaleKnown: boolean;
};

type CalibrationLike = {
  knownScaleMeters?: number | null;
  knownScalePixelDistance?: number | null;
  alternateImageSha256s?: string[];
};

type AnalysisLike = {
  confidence?: unknown;
  map?: unknown;
  landmarks?: unknown;
  assetTree?: unknown;
  validations?: unknown;
  calibrationEvidence?: CalibrationLike | null;
  cameraGeometryVerification?: CameraGeometryVerification;
  geometryVerification?: { cameraPoseVerified?: boolean } | null;
};

export function hasCompletedAnalysis(
  analysis: AnalysisLike | null | undefined,
): boolean {
  if (!analysis || typeof analysis !== "object") return false;
  return Boolean(
    analysis.map &&
      Array.isArray(analysis.landmarks) &&
      Array.isArray(analysis.assetTree) &&
      Array.isArray(analysis.validations) &&
      typeof analysis.confidence === "number",
  );
}

export function hasMetricScale(
  analysis: AnalysisLike | null | undefined,
): boolean {
  const meters = analysis?.calibrationEvidence?.knownScaleMeters;
  const pixels = analysis?.calibrationEvidence?.knownScalePixelDistance;
  return (
    typeof meters === "number" &&
    meters > 0 &&
    typeof pixels === "number" &&
    pixels >= 10
  );
}

function resolveImageCount(analysis: AnalysisLike): number {
  const fromCamera = analysis.cameraGeometryVerification?.imageHashes?.length;
  if (typeof fromCamera === "number" && fromCamera > 0) return fromCamera;
  const alternates =
    analysis.calibrationEvidence?.alternateImageSha256s?.length ?? 0;
  return Math.max(1, 1 + alternates);
}

export function computeExportReadiness(
  analysis: AnalysisLike | null | undefined,
): ExportReadiness {
  if (!hasCompletedAnalysis(analysis)) {
    return {
      tier: "draft",
      exportReadyCm: false,
      exportReadyDraft: false,
      exportReady: false,
      failingChecks: ["analysis-incomplete"],
      cameraGeometryVerified: false,
      metricScaleKnown: false,
    };
  }

  const imageCount = resolveImageCount(analysis!);
  const cameraGeometryVerified = isVerifiedCameraGeometry(
    analysis!.cameraGeometryVerification,
    imageCount,
  );
  const metricScaleKnown = hasMetricScale(analysis);
  const failingChecks: string[] = [];
  if (!cameraGeometryVerified) failingChecks.push("camera-geometry-unverified");
  if (!metricScaleKnown) failingChecks.push("metric-scale-unknown");

  if (cameraGeometryVerified && metricScaleKnown) {
    return {
      tier: "scale-locked",
      exportReadyCm: true,
      exportReadyDraft: true,
      exportReady: true,
      failingChecks: [],
      cameraGeometryVerified,
      metricScaleKnown,
    };
  }

  if (cameraGeometryVerified) {
    return {
      tier: "verified",
      exportReadyCm: false,
      exportReadyDraft: true,
      exportReady: false,
      failingChecks,
      cameraGeometryVerified,
      metricScaleKnown,
    };
  }

  return {
    tier: "draft",
    exportReadyCm: false,
    exportReadyDraft: true,
    exportReady: false,
    failingChecks,
    cameraGeometryVerified,
    metricScaleKnown,
  };
}

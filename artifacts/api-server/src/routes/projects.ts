import { Router, type IRouter, type Request, type Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  compareDepthUncertainty,
  generateDenseDepth,
  renderDenseDepthPreview,
  sampleDenseDepth,
  type DenseDepthArtifact,
  type DepthBand,
} from "../lib/depth-adapter";
import {
  verifyImageGeometry,
  type GeometryVerification,
} from "../lib/geometry-verifier";
import {
  isVerifiedCameraGeometry,
  runCameraGeometryVerification,
  type CameraGeometryVerification,
  type GeometryImage,
} from "../lib/camera-geometry";
import {
  computeExportReadiness,
  hasCompletedAnalysis,
} from "../lib/evidence-gates";
import {
  AnalyzeProjectBody,
  AnalyzeProjectParams,
  CreateProjectBody,
  ExportProjectParams,
  GetProjectParams,
  GetProjectSummaryParams,
  UpdateProjectBody,
  UpdateProjectParams,
  AnalyzeProjectResponse,
  type VisualSurvey,
} from "@workspace/api-zod";
import { loadPersistedProjects, savePersistedProject } from "../lib/persistence";
import { getSessionOwnerId } from "../lib/api-auth";
import { isInternalRequest } from "../lib/internal-auth";
import { logger } from "../lib/logger";
import { readObjectBytes } from "../lib/worldforge-storage";
import { parseVisualSurvey } from "../lib/visual-survey";
import {
  buildUnrealExportBundle,
} from "../lib/unreal-export";
const router: IRouter = Router();

type Analysis = {
  confidence: number;
  denseDepth?: DenseDepthArtifact;
  geometryVerification?: GeometryVerification;
  cameraGeometryVerification?: CameraGeometryVerification;
  confidenceBreakdown?: {
    visualDetection: number;
    scaleCalibration: number;
    depthInference: number;
    coverageCompleteness: number;
    spatialConsistency: number;
    depthEvidenceCoverage?: number;
    depthBandAgreement?: number;
    overall: number;
    target: number;
    ceiling: number;
    status:
      | "target-met"
      | "needs-calibration"
      | "needs-more-views"
      | "review-required";
    notes: string[];
  };
  calibrationEvidence?: {
    verificationStatus: "unverified-claim" | "solver-verified";
    canonicalImageSha256: string;
    alternateImageSha256s: string[];
    knownScaleMeters: number | null;
    knownScalePixelDistance: number | null;
    claimedReprojectionErrorPixels: number | null;
    solver: string;
    solverVersion: string;
    notes: string[];
  };
  reconstruction?: {
    mode: "single-view-3d-hypothesis" | "multi-view-verified";
    cameraModel: string;
    depthMethod: string;
    terrainMethod: string;
    occlusionMethod: string;
    virtualViewCount: number;
    limitations: string[];
  };
  depthMap?: {
    status: "ready" | "unavailable";
    provider: string;
    model: string;
    relativeOnly: boolean;
    width?: number;
    height?: number;
    min?: number;
    max?: number;
    mean?: number;
    inferenceMilliseconds?: number;
    sourceImageSha256?: string;
    previewUrl?: string;
    error?: string;
  };
  visualSurvey?: VisualSurvey;
  surveyAudit?: {
    status: "pass" | "review-required";
    objectCount: number;
    uniqueObjectCount: number;
    linkedLandmarkCount: number;
    unlinkedLandmarkCount: number;
    missingSurveyObjectCount: number;
    invalidGeometryCount: number;
    duplicateIdCount: number;
    notes: string[];
  };
  spatialRelations?: Array<{
    id: string;
    fromId: string;
    fromName: string;
    toId: string;
    toName: string;
    deltaX: number;
    deltaY: number;
    deltaZ: number;
    horizontalDistanceMeters: number;
    distance3dMeters: number;
    bearingDegrees: number;
    verticalAngleDegrees: number;
    uncertaintyMeters: number;
    confidence: number;
  }>;
  map: {
    widthMeters: number;
    depthMeters: number;
    maxElevationMeters: number;
    gridSizeMeters: number;
    chunkCount: number;
    origin: string;
    coordinateSystem: string;
  };
  layers: Array<{
    id: string;
    name: string;
    type: string;
    coverage: number;
    color: string;
    notes: string;
  }>;
  landmarks: Array<{
    id: string;
    name: string;
    type: string;
    x: number;
    y: number;
    z: number;
    rotation: number;
    scale: number;
    footprint: string;
    confidence: number;
    assetCount: number;
    uncertaintyMeters?: number;
    sourceSurveyObjectId?: string;
    depthEvidence?: {
      depthBand: DepthBand | "unknown";
      normalizedDepth: number | null;
      depthMeters: number | null;
      uncertaintyMeters: number | null;
      visualUncertaintyMeters: number | null;
      uncertaintyRatio: number | null;
      uncertaintyCrossCheck: "supported" | "review-required" | "unavailable";
      sampleCount: number;
      crossCheck:
        | "supported"
        | "nearby"
        | "review-required"
        | "unavailable";
      source: "dense-depth";
    };
  }>;
  assetTree: Array<{
    id: string;
    name: string;
    parent: string;
    category: string;
    kind: string;
    count: number;
    productionCount: number;
    placementCount: number;
    isReusable: boolean;
    dimensions: string;
    dimensionsMeters?: { x: number; y: number; z: number };
    instruction: string;
    sourcePrompt: string;
    placementInstructions: string;
    readEvidence: string;
    confidence?: number;
    placementPattern?: {
      type: "ellipse" | "arc";
      center: { x: number; y: number; z: number };
      radiusX: number;
      radiusY: number;
      startAngleDegrees: number;
      endAngleDegrees: number;
      closed: boolean;
      alignToTangent: boolean;
      rotationOffsetDegrees: number;
    };
    placements: Array<{
      id: string;
      assetId: string;
      parentLandmark: string;
      x: number;
      y: number;
      z: number;
      rotation: number;
      orientation?: { yaw: number; pitch: number; roll: number };
      scale: number;
      reason: string;
      uncertaintyMeters?: number;
    }>;
  }>;
  validations: Array<{
    id: string;
    severity: "pass" | "warning" | "critical";
    title: string;
    detail: string;
  }>;
  prompt: string;
};

type Project = {
  id: string;
  ownerId: string;
  name: string;
  imageName: string;
  status: "draft" | "analyzing" | "ready";
  updatedAt: string;
  analysis: Analysis;
  depthMapPreview?: Buffer | null;
  canonicalImageData?: string | null;
  referenceImages?: string[];
  canonicalImagePath?: string | null;
  referenceImagePaths?: string[];
  depthMapPreviewPath?: string | null;
  exportBundlePath?: string | null;
};

const now = () => new Date().toISOString();

const round = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const hashImageData = (value: string) =>
  createHash("sha256").update(value).digest("hex");

type SurveyObject = {
  id?: string;
  name?: string;
  category?: string;
  bbox?: { x?: number; y?: number; width?: number; height?: number };
  groundContact?: { x?: number; y?: number };
  depthBand?: string;
};
function enrichAnalysis(
  analysis: Analysis,
  evidence: {
    hasKnownScale: boolean;
    hasPixelCalibration: boolean;
    imageCount: number;
    reprojectionErrorPixels?: number;
    canonicalImageSha256: string;
    alternateImageSha256s: string[];
    knownScaleMeters: number | null;
    knownScalePixelDistance: number | null;
    denseDepthStatus?: DenseDepthArtifact["status"];
    cameraGeometryVerification?: CameraGeometryVerification;
  },
): Analysis {
  const mapSpan = Math.max(analysis.map.widthMeters, analysis.map.depthMeters);
  const landmarks = analysis.landmarks.map((landmark) => ({
    ...landmark,
    uncertaintyMeters:
      landmark.uncertaintyMeters ??
      round(
        Math.max(
          analysis.map.gridSizeMeters * 0.25,
          (1 - landmark.confidence) * mapSpan * 0.08,
        ),
      ),
  }));

  const assetTree = analysis.assetTree.map((asset) => {
    const confidence =
      asset.confidence ??
      round(Math.max(0.35, Math.min(0.99, analysis.confidence - 0.04)), 3);
    return {
      ...asset,
      confidence,
      placements: asset.placements.map((placement) => ({
        ...placement,
        uncertaintyMeters:
          placement.uncertaintyMeters ??
          round(
            Math.max(
              analysis.map.gridSizeMeters * 0.25,
              (1 - confidence) * mapSpan * 0.06,
            ),
          ),
      })),
    };
  });

  const spatialRelations = landmarks.flatMap((from, fromIndex) =>
    landmarks.slice(fromIndex + 1).map((to) => {
      const deltaX = to.x - from.x;
      const deltaY = to.y - from.y;
      const deltaZ = to.z - from.z;
      const horizontalDistanceMeters = Math.hypot(deltaX, deltaY);
      const distance3dMeters = Math.hypot(deltaX, deltaY, deltaZ);
      const uncertaintyMeters = from.uncertaintyMeters + to.uncertaintyMeters;
      return {
        id: `${from.id}--${to.id}`,
        fromId: from.id,
        fromName: from.name,
        toId: to.id,
        toName: to.name,
        deltaX: round(deltaX),
        deltaY: round(deltaY),
        deltaZ: round(deltaZ),
        horizontalDistanceMeters: round(horizontalDistanceMeters),
        distance3dMeters: round(distance3dMeters),
        bearingDegrees: round((Math.atan2(deltaY, deltaX) * 180) / Math.PI),
        verticalAngleDegrees: round(
          (Math.atan2(deltaZ, Math.max(horizontalDistanceMeters, 0.001)) *
            180) /
            Math.PI,
        ),
        uncertaintyMeters: round(uncertaintyMeters),
        confidence: round(Math.min(from.confidence, to.confidence), 3),
      };
    }),
  );

  const surveyObjects = analysis.visualSurvey?.objects ?? [];
  const surveyObjectIds = new Set(
    surveyObjects.map((object) => object.id).filter(Boolean),
  );
  const linkedSurveyObjectCount = new Set(
    landmarks
      .map((landmark) => landmark.sourceSurveyObjectId)
      .filter((id): id is string => Boolean(id && surveyObjectIds.has(id))),
  ).size;
  const surveyLinkage =
    surveyObjectIds.size > 0
      ? linkedSurveyObjectCount / surveyObjectIds.size
      : Math.min(1, landmarks.length / Math.max(assetTree.length, 1));
  const auditedObjectCount = Math.max(
    analysis.surveyAudit?.uniqueObjectCount ?? surveyObjectIds.size,
    1,
  );
  const surveyGeometryValidity = analysis.surveyAudit
    ? Math.max(
        0,
        1 - analysis.surveyAudit.invalidGeometryCount / auditedObjectCount,
      )
    : 0;
  const surveyIdIntegrity = analysis.surveyAudit
    ? Math.max(
        0,
        1 - analysis.surveyAudit.duplicateIdCount / auditedObjectCount,
      )
    : 0;
  const visualDetection = round(
    (surveyGeometryValidity + surveyIdIntegrity + surveyLinkage) / 3,
    3,
  );
  const verifiedAlternateViews =
    analysis.geometryVerification?.verifiedAlternateViewCount ?? 0;
  const requestedAlternateViews =
    analysis.geometryVerification?.requestedAlternateViewCount ??
    Math.max(0, evidence.imageCount - 1);
  const confirmedViewCount = 1 + verifiedAlternateViews;
  const registrationRatio =
    (1 + verifiedAlternateViews) / Math.max(1, 1 + requestedAlternateViews);
  const viewInformationGain =
    Math.log2(Math.min(9, confirmedViewCount) + 1) / Math.log2(10);
  const verifiedViewEvidence = viewInformationGain * registrationRatio;
  const coverageCompleteness = round(
    (surveyLinkage +
      surveyGeometryValidity +
      surveyIdIntegrity +
      verifiedViewEvidence) /
      4,
    3,
  );
  const countConsistency =
    assetTree.filter(
      (asset) =>
        asset.count === asset.placementCount &&
        asset.productionCount > 0 &&
        asset.placementCount > 0,
    ).length / Math.max(assetTree.length, 1);
  const coordinateConsistency =
    landmarks.filter(
      (landmark) =>
        [
          landmark.x,
          landmark.y,
          landmark.z,
          landmark.rotation,
          landmark.scale,
        ].every(Number.isFinite) &&
        Math.abs(landmark.x) <= analysis.map.widthMeters / 2 &&
        Math.abs(landmark.y) <= analysis.map.depthMeters / 2,
    ).length / Math.max(landmarks.length, 1);
  const placements = assetTree.flatMap((asset) => asset.placements);
  const placementConsistency =
    placements.filter(
      (placement) =>
        [
          placement.x,
          placement.y,
          placement.z,
          placement.rotation,
          placement.scale,
        ].every(Number.isFinite) &&
        Math.abs(placement.x) <= analysis.map.widthMeters / 2 &&
        Math.abs(placement.y) <= analysis.map.depthMeters / 2,
    ).length / Math.max(placements.length, 1);
  const spatialConsistency = round(
    (countConsistency + coordinateConsistency + placementConsistency) / 3,
    3,
  );
  const hasGeometricValidation = isVerifiedCameraGeometry(
    evidence.cameraGeometryVerification,
    evidence.imageCount,
  );
  const reprojectionMean =
    evidence.cameraGeometryVerification?.residualDistribution?.meanPixels;
  const solverQuality =
    hasGeometricValidation && typeof reprojectionMean === "number"
      ? Math.max(0, Math.min(1, 1 - reprojectionMean / 4))
      : 0;
  const scaleCalibration = round(
    ((evidence.hasKnownScale ? 1 : 0) +
      (evidence.hasPixelCalibration ? 1 : 0) +
      solverQuality) /
      3,
    3,
  );
  const depthEvidence = landmarks
    .map((landmark) => landmark.depthEvidence)
    .filter((item) => item && item.sampleCount > 0);
  const depthEvidenceCoverage = round(
    depthEvidence.length / Math.max(landmarks.length, 1),
    3,
  );
  const depthBandAgreement = round(
    depthEvidence.reduce(
      (score, item) =>
        score +
        (item?.crossCheck === "supported"
          ? 1
          : item?.crossCheck === "nearby"
            ? 0.5
            : 0),
      0,
    ) / Math.max(depthEvidence.length, 1),
    3,
  );
  const depthAvailability =
    evidence.denseDepthStatus === "ready"
      ? 1
      : evidence.denseDepthStatus === "fallback"
        ? 0.5
        : 0;
  const depthInference = round(
    (depthAvailability +
      depthEvidenceCoverage +
      depthBandAgreement +
      verifiedViewEvidence +
      solverQuality) /
      5,
    3,
  );
  // Honest confidence formula (MATH_FIRST_99 — no proxy boosts):
  // weighted = visualDetection*0.27 + scaleCalibration*0.20 + depthInference*0.20
  //          + coverageCompleteness*0.16 + spatialConsistency*0.17
  // ceiling  = evidenceCeiling only (never jump to 0.995). Without scale+geometry gates,
  //            hard-cap <=0.98 so the UI cannot claim ~99%. With gates, allow up to 1.0
  //            but never Math.max(0.99, weighted).
  // overall  = min(ceiling, weighted)
  // target-met iff weighted>=0.99 AND hasPixelCalibration AND hasGeometricValidation
  //            AND no landmark depthEvidence.crossCheck === "review-required".
  const evidenceCeiling =
    0.45 +
    scaleCalibration * 0.18 +
    depthInference * 0.12 +
    verifiedViewEvidence * 0.13 +
    coverageCompleteness * 0.08 +
    spatialConsistency * 0.04;
  const gatesOpen =
    evidence.hasPixelCalibration && hasGeometricValidation;
  const ceiling = gatesOpen
    ? round(Math.max(0.5, Math.min(1, evidenceCeiling)), 3)
    : round(Math.max(0.5, Math.min(0.98, evidenceCeiling)), 3);
  const weighted =
    visualDetection * 0.27 +
    scaleCalibration * 0.2 +
    depthInference * 0.2 +
    coverageCompleteness * 0.16 +
    spatialConsistency * 0.17;
  const overall = round(Math.min(ceiling, weighted), 3);
  const hasDepthReview = landmarks.some(
    (landmark) => landmark.depthEvidence?.crossCheck === "review-required",
  );
  const status = hasDepthReview
    ? "review-required"
    : weighted >= 0.99 && gatesOpen
      ? "target-met"
      : !evidence.hasPixelCalibration
        ? "needs-calibration"
        : !hasGeometricValidation
          ? "needs-more-views"
          : "review-required";
  const validations = analysis.validations.map((validation) =>
    !hasGeometricValidation && /scale is calibrated/i.test(validation.title)
      ? {
          ...validation,
          severity: "warning" as const,
          title: "World scale is a planning hypothesis",
          detail:
            "Map dimensions are an editable Unreal blockout envelope inferred from the concept; no survey-grade scale calibration is available.",
        }
      : validation,
  );

  return {
    ...analysis,
    confidence: overall,
    landmarks,
    assetTree,
    validations,
    spatialRelations,
    geometryVerification: analysis.geometryVerification
      ? {
          ...analysis.geometryVerification,
          cameraPoseVerified: hasGeometricValidation,
        }
      : analysis.geometryVerification,
    confidenceBreakdown: {
      visualDetection,
      scaleCalibration,
      depthInference,
      coverageCompleteness,
      spatialConsistency,
      depthEvidenceCoverage,
      depthBandAgreement,
      overall,
      target: 0.99,
      ceiling,
      status,
      notes: [
        evidence.hasPixelCalibration
          ? "A verified meter length and its pixel span anchor the scale conversion."
          : "Add a verified meter length and the matching pixel span; a meter value alone is insufficient.",
        hasGeometricValidation
          ? `${evidence.cameraGeometryVerification?.imageHashes.length} views have a server-computed mean reprojection residual of ${evidence.cameraGeometryVerification?.residualDistribution?.meanPixels.toFixed(3)}px (${evidence.cameraGeometryVerification?.inlierCount} inliers).`
          : evidence.cameraGeometryVerification?.residualDistribution
            ? `Server-computed mean reprojection residual is ${evidence.cameraGeometryVerification.residualDistribution.meanPixels.toFixed(3)}px; 99% requires at least three views and a mean of 1px or less.`
            : "99% requires at least three same-scene views, a COLMAP/pycolmap solve, and server-computed reprojection residuals of 1px or less.",
        evidence.denseDepthStatus === "ready"
          ? `Dense depth sampled ${Math.round(depthEvidenceCoverage * 100)}% of landmarks; ${Math.round(depthBandAgreement * 100)}% of sampled landmarks agree with the visual depth survey.`
          : evidence.denseDepthStatus === "fallback"
            ? "The configured depth model was unavailable; a deterministic image-cue depth map was retained and marked as a fallback."
            : "Dense depth was unavailable; landmark uncertainty remains heuristic until a depth adapter is configured.",
        `${evidence.imageCount} unique image(s) were submitted; ${confirmedViewCount} view(s) contributed after same-scene registration. Unregistered uploads do not raise confidence.`,
        `Server audit accepted ${Math.round(surveyGeometryValidity * 100)}% of survey geometry; ${linkedSurveyObjectCount} of ${surveyObjectIds.size} surveyed object(s) are linked to world landmarks.`,
        "XYZ relations are deterministic calculations over model-inferred coordinates; uncertainty remains heuristic until geometric validation.",
      ],
    },
    calibrationEvidence: {
      verificationStatus: hasGeometricValidation
        ? "solver-verified"
        : "unverified-claim",
      canonicalImageSha256: evidence.canonicalImageSha256,
      alternateImageSha256s: evidence.alternateImageSha256s,
      knownScaleMeters: evidence.knownScaleMeters,
      knownScalePixelDistance: evidence.knownScalePixelDistance,
      claimedReprojectionErrorPixels: evidence.reprojectionErrorPixels ?? null,
      solver: evidence.cameraGeometryVerification?.solver ?? "none",
      solverVersion: evidence.cameraGeometryVerification?.solverVersion ?? "none",
      notes: [
        "Image hashes provide audit identity only; they do not prove view uniqueness or scene overlap.",
        hasGeometricValidation
          ? "Camera poses, point tracks, inlier counts and reprojection residuals were verified server-side from a COLMAP/pycolmap solve."
          : "Scale span and RMS are user-supplied claims and cannot unlock 99% confidence; a server-verified camera solve is required.",
      ],
    },
    cameraGeometryVerification: evidence.cameraGeometryVerification,
    reconstruction: {
      mode: hasGeometricValidation
        ? "multi-view-verified"
        : "single-view-3d-hypothesis",
      cameraModel:
        "Perspective concept camera with horizon and vanishing-direction priors",
      depthMethod:
        analysis.denseDepth?.status === "ready"
          ? `${analysis.denseDepth.provider} dense depth map${
              analysis.denseDepth.focalLengthPx
                ? " with focal-length output"
                : ""
            }${analysis.denseDepth.normalsBase64 ? " with surface-normal output" : ""}, cross-checked against visual survey bands`
          : analysis.denseDepth?.status === "fallback"
            ? "Deterministic image-cue dense depth fallback with per-pixel uncertainty, cross-checked against visual survey bands"
            : "Screen-space depth bands combined with occlusion ordering, landmark class priors, silhouette size, and terrain continuity",
      terrainMethod:
        "Layered heightfield hypothesis: visible ridge/valley continuity first, hidden terrain filled with conservative slope envelopes",
      occlusionMethod:
        "Foreground/background ordering inferred from overlap, atmospheric scale, cast-shadow direction, and structure visibility",
      virtualViewCount: hasGeometricValidation ? evidence.imageCount : 1,
      limitations: [
        "A single perspective image cannot prove hidden backsides, absolute scale, or camera pose.",
        "Virtual depth is a production hypothesis for blockout and placement, not a survey measurement.",
        "Repeated structures are instanced from visible evidence; unseen repetition is marked procedural.",
      ],
    },
  };
}

function buildSeedAnalysis(
  widthMeters = 24000,
  depthMeters = 18000,
  gridSizeMeters = 100,
): Analysis {
  const chunkCount =
    Math.ceil(widthMeters / 1024) * Math.ceil(depthMeters / 1024);
  return enrichAnalysis(
    {
      confidence: 0.87,
      visualSurvey: buildSeedVisualSurvey(),
      map: {
        widthMeters,
        depthMeters,
        maxElevationMeters: 980,
        gridSizeMeters,
        chunkCount,
        origin: "Map center at sea-level datum · X east / Y south / Z up",
        coordinateSystem:
          "World Forge meters · Unreal-compatible left-handed Z-up · export ×100cm",
      },
      layers: [
        {
          id: "water",
          name: "Open water",
          type: "biome",
          coverage: 44,
          color: "#31566a",
          notes: "Base sea plane at Z = -20m; jagged coastline mask.",
        },
        {
          id: "rock",
          name: "Cliff & volcanic rock",
          type: "terrain",
          coverage: 18,
          color: "#9c6b4c",
          notes: "Slope break above 32°; high-contrast basalt material.",
        },
        {
          id: "city",
          name: "Fortified city",
          type: "settlement",
          coverage: 9,
          color: "#d1a76f",
          notes: "Dense modular city ring around the central ziggurat.",
        },
        {
          id: "snow",
          name: "Alpine snow",
          type: "biome",
          coverage: 12,
          color: "#d9e8ec",
          notes: "Snowline begins above Z = 640m on the eastern ridge.",
        },
        {
          id: "roads",
          name: "Traversal network",
          type: "infrastructure",
          coverage: 5,
          color: "#dfb45b",
          notes: "Primary path width 7m; secondary paths 3m.",
        },
        {
          id: "cemetery",
          name: "Cemetery & memorial ground",
          type: "landmark zone",
          coverage: 4,
          color: "#7d8989",
          notes:
            "Separate kümbet, grave-marker rows and approach path from the arena.",
        },
        {
          id: "ruins",
          name: "Ancient column ruins",
          type: "landmark zone",
          coverage: 2,
          color: "#aa8c67",
          notes:
            "Keep columns as reusable modular pieces beside the lava channels.",
        },
      ],
      landmarks: [
        {
          id: "central-city",
          name: "Citadel city",
          type: "fortified settlement",
          x: 0,
          y: 850,
          z: 235,
          rotation: -8,
          scale: 1,
          footprint: "1,920m × 1,460m",
          confidence: 0.93,
          assetCount: 486,
        },
        {
          id: "ziggurat",
          name: "Central ziggurat",
          type: "hero landmark",
          x: -40,
          y: 910,
          z: 420,
          rotation: 0,
          scale: 1,
          footprint: "410m × 360m",
          confidence: 0.96,
          assetCount: 74,
        },
        {
          id: "arena",
          name: "Cliff arena",
          type: "monument",
          x: 6_480,
          y: 3_760,
          z: 178,
          rotation: 16,
          scale: 1,
          footprint: "680m × 520m",
          confidence: 0.91,
          assetCount: 118,
        },
        {
          id: "volcano",
          name: "Active volcano",
          type: "terrain landmark",
          x: 5_850,
          y: -4_900,
          z: 770,
          rotation: 0,
          scale: 1,
          footprint: "3,100m × 2,700m",
          confidence: 0.89,
          assetCount: 36,
        },
        {
          id: "ice-island",
          name: "Moonlit ice island",
          type: "distant landmark",
          x: -6_800,
          y: -4_950,
          z: 30,
          rotation: -4,
          scale: 1,
          footprint: "1,250m × 940m",
          confidence: 0.74,
          assetCount: 28,
        },
        {
          id: "western-harbor",
          name: "Western harbor & piers",
          type: "waterfront landmark",
          x: -2_640,
          y: 2_120,
          z: 30,
          rotation: 90,
          scale: 1,
          footprint: "1,480m × 820m",
          confidence: 0.88,
          assetCount: 43,
        },
        {
          id: "cemetery",
          name: "Eastern cemetery & kümbet",
          type: "memorial landmark",
          x: 5_980,
          y: 1_180,
          z: 190,
          rotation: -12,
          scale: 1,
          footprint: "940m × 680m",
          confidence: 0.84,
          assetCount: 149,
        },
        {
          id: "column-ruins",
          name: "Eastern column temple ruins",
          type: "ruin landmark",
          x: 6_880,
          y: -2_740,
          z: 460,
          rotation: 4,
          scale: 1,
          footprint: "520m × 310m",
          confidence: 0.82,
          assetCount: 32,
        },
        {
          id: "moonwatch",
          name: "Distant moonwatch colossus",
          type: "distant monument",
          x: 0,
          y: -6_200,
          z: 180,
          rotation: 0,
          scale: 1,
          footprint: "420m × 280m",
          confidence: 0.72,
          assetCount: 1,
        },
      ],
      assetTree: [
        {
          id: "city-walls",
          name: "Citadel wall kit",
          parent: "Citadel city",
          category: "fortification",
          kind: "modular assembly",
          count: 42,
          productionCount: 4,
          placementCount: 42,
          isReusable: true,
          dimensions: "18m × 6m × 14m",
          instruction:
            "Create snap-ready straight, corner, gate and damaged variants; use 1m grid sockets and preserve walkable parapet.",
          sourcePrompt:
            "Four production variants: straight basalt wall, corner wall, gate wall, damaged wall. Match dark volcanic stone, warm inset lamps, and stepped fortress silhouette.",
          placementInstructions:
            "Build the four variants once. Place 42 instances along the city perimeter, with gate variants only at the south and east entrances.",
          readEvidence:
            "Continuous fortified ring, repeated crenellations, corner towers and two readable gate breaks.",
          placements: [
            {
              id: "city-walls-p01",
              assetId: "city-walls",
              parentLandmark: "Citadel city",
              x: -860,
              y: 240,
              z: 228,
              rotation: 0,
              scale: 1,
              reason: "west perimeter",
            },
            {
              id: "city-walls-p02",
              assetId: "city-walls",
              parentLandmark: "Citadel city",
              x: -420,
              y: -420,
              z: 238,
              rotation: 90,
              scale: 1,
              reason: "northwest turn",
            },
            {
              id: "city-walls-p03",
              assetId: "city-walls",
              parentLandmark: "Citadel city",
              x: 780,
              y: 360,
              z: 224,
              rotation: 180,
              scale: 1,
              reason: "east perimeter",
            },
          ],
        },
        {
          id: "city-houses",
          name: "Dense city house kit",
          parent: "Citadel city",
          category: "architecture",
          kind: "modular assembly",
          count: 164,
          productionCount: 6,
          placementCount: 164,
          isReusable: true,
          dimensions: "8–22m × 6–16m × 5–18m",
          instruction:
            "Build facade, floor, stair, roof and interior modules separately. Generate 6 silhouettes and keep door thresholds at Z=0.",
          sourcePrompt:
            "Generate six compatible enterable house silhouettes from shared walls, floors, doors, windows, stairs and roof pieces. Preserve warm window light and compact medieval massing.",
          placementInstructions:
            "Produce six silhouettes once, then place 164 houses using the city density map. Rotate facades toward the nearest street spline and keep 3m fire-lane clearance.",
          readEvidence:
            "Dozens of individually readable rooflines, warm windows, narrow streets and clustered dwellings inside the wall.",
          placements: [
            {
              id: "city-houses-p01",
              assetId: "city-houses",
              parentLandmark: "Citadel city",
              x: -530,
              y: 310,
              z: 246,
              rotation: 24,
              scale: 1,
              reason: "dense west quarter",
            },
            {
              id: "city-houses-p02",
              assetId: "city-houses",
              parentLandmark: "Citadel city",
              x: 280,
              y: 420,
              z: 250,
              rotation: -18,
              scale: 0.85,
              reason: "south market quarter",
            },
            {
              id: "city-houses-p03",
              assetId: "city-houses",
              parentLandmark: "Citadel city",
              x: 510,
              y: -120,
              z: 264,
              rotation: 42,
              scale: 1.1,
              reason: "east slope quarter",
            },
          ],
        },
        {
          id: "ziggurat-steps",
          name: "Ziggurat terraces",
          parent: "Central ziggurat",
          category: "hero architecture",
          kind: "hero assembly",
          count: 12,
          productionCount: 3,
          placementCount: 12,
          isReusable: true,
          dimensions: "410m × 360m × 34m each",
          instruction:
            "Stack stepped terraces around a central axis; expose sockets for cyan emissive channels and hero prop placement.",
          sourcePrompt:
            "Three stepped terrace modules with shared sandstone-dark basalt material, emissive cyan channels, stairs, parapets and socketed hero props.",
          placementInstructions:
            "Produce three terrace variants once and stack 12 placements around the ziggurat axis; alternate variants to avoid visible repetition.",
          readEvidence:
            "Central stepped pyramid with multiple terraces, axial stairs, cyan channels and a smaller summit temple.",
          placements: [
            {
              id: "ziggurat-p01",
              assetId: "ziggurat-steps",
              parentLandmark: "Central ziggurat",
              x: -40,
              y: 910,
              z: 420,
              rotation: 0,
              scale: 1,
              reason: "lowest terrace ring",
            },
            {
              id: "ziggurat-p02",
              assetId: "ziggurat-steps",
              parentLandmark: "Central ziggurat",
              x: -40,
              y: 910,
              z: 454,
              rotation: 90,
              scale: 0.78,
              reason: "second terrace ring",
            },
          ],
        },
        {
          id: "harbor-piers",
          name: "Harbor pier kit",
          parent: "Western harbor",
          category: "waterfront",
          kind: "modular assembly",
          count: 18,
          productionCount: 3,
          placementCount: 18,
          isReusable: true,
          dimensions: "42m × 7m × 4m",
          instruction:
            "Place on waterline with 2m clearance between hulls; support diagonal braces and lantern sockets.",
          sourcePrompt:
            "Three pier modules: straight timber pier, angled mooring pier, stone quay. Add rope, lantern and mooring-post sockets.",
          placementInstructions:
            "Produce three pier modules once. Place 18 instances along the western harbor spline, with 2m gaps for boats and 7m wide player traversal.",
          readEvidence:
            "Several piers project into the water at lower-left and west edge, with boats tied alongside.",
          placements: [
            {
              id: "harbor-piers-p01",
              assetId: "harbor-piers",
              parentLandmark: "Western harbor",
              x: -2_600,
              y: 1_980,
              z: 32,
              rotation: 88,
              scale: 1,
              reason: "main harbor finger",
            },
            {
              id: "harbor-piers-p02",
              assetId: "harbor-piers",
              parentLandmark: "Western harbor",
              x: -3_050,
              y: 2_260,
              z: 34,
              rotation: 104,
              scale: 1,
              reason: "outer mooring finger",
            },
          ],
        },
        {
          id: "boats",
          name: "Harbor boat kit",
          parent: "Western harbor",
          category: "watercraft",
          kind: "modular asset",
          count: 11,
          productionCount: 3,
          placementCount: 11,
          isReusable: true,
          dimensions: "12–28m × 4–8m × 4–10m",
          instruction:
            "Create small fishing boat, covered cargo boat and long sailboat as separate reusable meshes; expose sail, mast and rope sockets.",
          sourcePrompt:
            "Three low-poly but readable medieval harbor boats with shared wood language: fishing skiff, cargo boat, long sailboat. Include empty mast and sail sockets.",
          placementInstructions:
            "Generate three boat meshes once. Place 11 instances at piers and shoreline, vary rotation ±8° and waterline Z within ±0.4m; do not duplicate geometry for each boat.",
          readEvidence:
            "At least six hull silhouettes, masts and sails are visible in the lower-left harbor and foreground water.",
          placements: [
            {
              id: "boats-p01",
              assetId: "boats",
              parentLandmark: "Western harbor",
              x: -2_720,
              y: 2_120,
              z: 26,
              rotation: 92,
              scale: 1,
              reason: "tied to main pier",
            },
            {
              id: "boats-p02",
              assetId: "boats",
              parentLandmark: "Western harbor",
              x: -3_240,
              y: 2_460,
              z: 27,
              rotation: 116,
              scale: 0.82,
              reason: "outer cargo mooring",
            },
            {
              id: "boats-p03",
              assetId: "boats",
              parentLandmark: "Western harbor",
              x: -1_980,
              y: 2_420,
              z: 26,
              rotation: 74,
              scale: 0.68,
              reason: "foreground skiff",
            },
          ],
        },
        {
          id: "arena-seats",
          name: "Arena seating bowl",
          parent: "Cliff arena",
          category: "monument",
          kind: "modular assembly",
          count: 64,
          productionCount: 4,
          placementCount: 64,
          isReusable: true,
          dimensions: "24m × 8m × 6m",
          instruction:
            "Radial modules around the center; maintain 4m circulation rings and a clear combat floor.",
          sourcePrompt:
            "Four radial amphitheater seating modules with stone steps, torch sockets, aisle breaks and guardrails. Match the circular cliff arena.",
          placementInstructions:
            "Produce four radial modules once and place 64 around six seating rings; reserve four aisle breaks and keep combat floor clear.",
          readEvidence:
            "Large circular stepped amphitheater on the lower-right cliff, with repeated seating arcs and warm perimeter lights.",
          placements: [
            {
              id: "arena-seats-p01",
              assetId: "arena-seats",
              parentLandmark: "Cliff arena",
              x: 6_480,
              y: 3_760,
              z: 178,
              rotation: 16,
              scale: 1,
              reason: "south seating arc",
            },
            {
              id: "arena-seats-p02",
              assetId: "arena-seats",
              parentLandmark: "Cliff arena",
              x: 6_480,
              y: 3_760,
              z: 184,
              rotation: 46,
              scale: 1,
              reason: "southeast seating arc",
            },
          ],
        },
        {
          id: "dome-tomb",
          name: "Dome tomb / rotunda",
          parent: "Eastern cemetery",
          category: "architecture",
          kind: "hero assembly",
          count: 1,
          productionCount: 1,
          placementCount: 1,
          isReusable: false,
          dimensions: "210m × 180m × 150m",
          instruction:
            "Build foundation, circular wall, stair ring, dome, finial and entrance as separate pieces; keep the interior openable.",
          sourcePrompt:
            "Single monumental domed tomb with circular stone drum, narrow entrance, ribbed dome, pointed finial and warm interior lamps. Make the room enterable.",
          placementInstructions:
            "Place once on the eastern cemetery plateau, aligned to the radial graveyard path. Keep a 12m clear approach and expose an interior doorway socket.",
          readEvidence:
            "Distinct domed rotunda at right-center behind the arena, clearly separate from the city and cemetery.",
          placements: [
            {
              id: "dome-tomb-p01",
              assetId: "dome-tomb",
              parentLandmark: "Eastern cemetery",
              x: 5_980,
              y: 1_180,
              z: 190,
              rotation: -12,
              scale: 1,
              reason: "cemetery hero structure",
            },
          ],
        },
        {
          id: "cemetery-stones",
          name: "Cemetery stone set",
          parent: "Eastern cemetery",
          category: "environment prop",
          kind: "scatter set",
          count: 148,
          productionCount: 5,
          placementCount: 148,
          isReusable: true,
          dimensions: "1–4m × 0.6–2m × 1–5m",
          instruction:
            "Make five readable grave and marker variants with eroded edges; place along curved rows and avoid arena sightline.",
          sourcePrompt:
            "Five worn cemetery marker variants: slab, obelisk, broken column, low cairn and crossbar stone. Match wet dark rock and moonlit rim light.",
          placementInstructions:
            "Produce five variants once. Place 148 markers in curved radial rows around the dome tomb, with 2–4m spacing and 30% rotation variation.",
          readEvidence:
            "Dense field of narrow upright stones and grave markers across the right midground.",
          placements: [
            {
              id: "cemetery-stones-p01",
              assetId: "cemetery-stones",
              parentLandmark: "Eastern cemetery",
              x: 5_420,
              y: 860,
              z: 182,
              rotation: 12,
              scale: 1,
              reason: "first grave row",
            },
            {
              id: "cemetery-stones-p02",
              assetId: "cemetery-stones",
              parentLandmark: "Eastern cemetery",
              x: 6_220,
              y: 1_520,
              z: 198,
              rotation: -20,
              scale: 1.2,
              reason: "outer grave row",
            },
          ],
        },
        {
          id: "column-ruins",
          name: "Column ruin kit",
          parent: "Eastern temple ruins",
          category: "ruins",
          kind: "modular assembly",
          count: 32,
          productionCount: 4,
          placementCount: 32,
          isReusable: true,
          dimensions: "3–8m × 3–8m × 10–34m",
          instruction:
            "Create intact column, broken column, capital and fallen shaft pieces; arrange as a ruined processional temple.",
          sourcePrompt:
            "Four ancient stone column variants with chipped capitals, broken shafts and ash weathering. Keep pieces independent for procedural collapse.",
          placementInstructions:
            "Produce four variants once. Place 32 instances in two parallel ruin rows east of the volcano, with 6m aisle clearance and a collapsed section at the southern end.",
          readEvidence:
            "Multiple tall columns and temple-like ruins are visible on the volcanic ridge to the right.",
          placements: [
            {
              id: "column-ruins-p01",
              assetId: "column-ruins",
              parentLandmark: "Eastern temple ruins",
              x: 6_880,
              y: -2_740,
              z: 460,
              rotation: 4,
              scale: 1,
              reason: "north colonnade",
            },
            {
              id: "column-ruins-p02",
              assetId: "column-ruins",
              parentLandmark: "Eastern temple ruins",
              x: 7_040,
              y: -2_920,
              z: 452,
              rotation: 178,
              scale: 0.82,
              reason: "fallen south colonnade",
            },
          ],
        },
        {
          id: "volcanic-props",
          name: "Volcanic prop scatter",
          parent: "Active volcano",
          category: "environment prop",
          kind: "scatter set",
          count: 220,
          productionCount: 8,
          placementCount: 220,
          isReusable: true,
          dimensions: "0.5–8m",
          instruction:
            "Distribute by slope mask; never place on traversal spline or within 6m of a landmark bounding box.",
          sourcePrompt:
            "Eight reusable volcanic props: basalt chunk, obsidian shard, sulfur vent, ash mound, lava seam, burnt tree, ember brazier and cracked shrine stone.",
          placementInstructions:
            "Produce eight props once. Distribute 220 instances by slope and heat masks; keep a 6m landmark exclusion zone and reserve lava seams for the volcano spline.",
          readEvidence:
            "Lava channels, ash, smoking vents and dark rock scatter around the active volcano.",
          placements: [
            {
              id: "volcanic-props-p01",
              assetId: "volcanic-props",
              parentLandmark: "Active volcano",
              x: 5_850,
              y: -4_900,
              z: 770,
              rotation: 0,
              scale: 1,
              reason: "caldera edge scatter",
            },
            {
              id: "volcanic-props-p02",
              assetId: "volcanic-props",
              parentLandmark: "Active volcano",
              x: 6_260,
              y: -4_320,
              z: 622,
              rotation: 42,
              scale: 1.4,
              reason: "lava channel edge",
            },
          ],
        },
        {
          id: "lantern-fire",
          name: "Lantern and fire kit",
          parent: "All inhabited areas",
          category: "lighting prop",
          kind: "reusable prop",
          count: 188,
          productionCount: 4,
          placementCount: 188,
          isReusable: true,
          dimensions: "0.4–3m",
          instruction:
            "Create wall lantern, brazier, hanging lamp and lava brazier with light-function material and socketed point light.",
          sourcePrompt:
            "Four reusable warm light props with physically readable flame, soot and emissive falloff; preserve the contrast between habitation and cold moonlight.",
          placementInstructions:
            "Produce four props once. Place 188 instances at doors, piers, arena perimeter, ziggurat stairs and volcano lava channels using the illumination mask.",
          readEvidence:
            "Repeated warm light points across the city, docks, arena, shrine and lava channels.",
          placements: [
            {
              id: "lantern-fire-p01",
              assetId: "lantern-fire",
              parentLandmark: "Citadel city",
              x: -210,
              y: 460,
              z: 255,
              rotation: 0,
              scale: 1,
              reason: "city street lighting",
            },
            {
              id: "lantern-fire-p02",
              assetId: "lantern-fire",
              parentLandmark: "Cliff arena",
              x: 6_760,
              y: 3_760,
              z: 194,
              rotation: 90,
              scale: 1,
              reason: "arena rim lighting",
            },
          ],
        },
      ],
      validations: [
        {
          id: "scale",
          severity: "pass",
          title: "World scale is calibrated",
          detail:
            "1 Unreal unit = 1 centimeter. Primary map dimensions resolve to 24km × 18km.",
        },
        {
          id: "slope",
          severity: "pass",
          title: "Traversal slopes are feasible",
          detail:
            "Primary paths stay below 14°; cliff-facing routes need spline stairs or lift volumes.",
        },
        {
          id: "depth",
          severity: "warning",
          title: "Depth is inferred from a single view",
          detail:
            "Distant ice island and the moonlit statue use confidence ranges. Keep their anchor points editable.",
        },
        {
          id: "streaming",
          severity: "pass",
          title: "Chunk budget is predictable",
          detail: `${chunkCount} landscape chunks at ${gridSizeMeters}m planning resolution; stream the city and volcano as priority cells.`,
        },
        {
          id: "inventory",
          severity: "pass",
          title: "Secondary structures are inventoried",
          detail:
            "The read includes the western piers and boats, eastern kümbet and cemetery, column ruins, towers, gates, arena, distant islands and lighting props.",
        },
        {
          id: "reuse",
          severity: "pass",
          title: "Production and placement are separated",
          detail:
            "Repeated wall, boat, pier, grave-marker and column geometry is generated once per variant and instanced at its world transforms.",
        },
      ],
      prompt:
        "You are a senior Unreal Engine 5 world builder and Rodin production planner. Reconstruct the provided concept image as a playable open world using the supplied measured manifest. Treat every coordinate as centimeters in a right-handed Unreal coordinate system. Analyze the image in three passes: macro terrain and water, mid-scale landmarks and architecture, then small props, transport, lighting and set dressing. Do not stop after reading the obvious city and volcano. Explicitly inventory domes and tombs, piers, boats, docks, forts, towers, gates, cemeteries, standing stones, column ruins, small islands, distant statues, snowy peaks, lava channels, smoke, lanterns, braziers and all repeated silhouettes visible in the reference. Preserve the specified clearances, path widths, pivots, sockets, streaming chunks and confidence notes. For every asset, separate single production from multiple placement: Rodin productionCount is the number of unique meshes to generate, placementCount is the number of world instances, and placements contains the transforms. If a piece is geometrically identical, generate it once and reuse it; only distinct variants may increase productionCount. Do not collapse an enterable building into a single static mesh; keep shell, foundation, floors, stairs, openings, dome/roof and interior modules independently editable.",
    },
    {
      hasKnownScale: false,
      hasPixelCalibration: false,
      imageCount: 1,
      canonicalImageSha256: "seed-analysis",
      alternateImageSha256s: [],
      knownScaleMeters: null,
      knownScalePixelDistance: null,
    },
  );
}

function buildSeedVisualSurvey(): VisualSurvey {
  const objects = [
    ["citadel", "Stepped citadel", "fortified settlement", 0.31, 0.31, 0.27, 0.3, "midground"],
    ["harbor", "Western harbor and piers", "waterfront", 0.04, 0.58, 0.3, 0.25, "foreground"],
    ["arena", "Cliff arena", "monument", 0.7, 0.5, 0.2, 0.19, "midground"],
    ["volcano", "Active volcano", "terrain landmark", 0.67, 0.08, 0.28, 0.43, "background"],
    ["cemetery", "Eastern cemetery and kümbet", "memorial ground", 0.76, 0.42, 0.17, 0.18, "midground"],
    ["column-ruins", "Eastern column ruins", "ruins", 0.83, 0.3, 0.12, 0.2, "background"],
    ["ice-island", "Moonlit ice island", "island", 0.02, 0.2, 0.2, 0.28, "distant"],
    ["moonwatch", "Distant moonwatch colossus", "monument", 0.47, 0.08, 0.05, 0.18, "distant"],
  ] as const;
  return {
    version: 1,
    cameraHypothesis: {
      horizonY: 0.36,
      perspectiveStrength: "medium",
      viewElevation: "elevated",
      vanishingDirections: [
        {
          x: 0.5,
          y: 0.35,
          evidence: "Citadel terraces and harbor edges converge toward the central horizon.",
        },
      ],
    },
    depthBands: [
      { id: "band-foreground", order: 0, range: "foreground", evidence: "Large boats, piers and near shoreline silhouettes." },
      { id: "band-midground", order: 1, range: "midground", evidence: "Citadel, arena and cemetery retain strong local contrast." },
      { id: "band-background", order: 2, range: "background", evidence: "Volcanic and ruined ridges sit behind the settlement." },
      { id: "band-distant", order: 3, range: "distant", evidence: "Ice island and colossus are reduced by atmospheric perspective." },
    ],
    objects: objects.map(([id, name, category, x, y, width, height, depthBand]) => ({
      id,
      name,
      category,
      bbox: { x, y, width, height },
      depthBand,
      groundContact: { x: x + width / 2, y: y + height },
      occludes: id === "citadel" ? ["volcano"] : [],
      occludedBy: id === "volcano" ? ["citadel"] : [],
      visibleParts: [name],
      repeatedPattern: "",
      evidence: `${name} is retained as a distinct visible silhouette in the canonical composition.`,
      confidence: depthBand === "distant" ? 0.72 : 0.88,
    })),
    terrainContours: [
      {
        kind: "eastern volcanic ridge",
        points: [{ x: 0.61, y: 0.48 }, { x: 0.73, y: 0.2 }, { x: 0.94, y: 0.54 }],
        evidence: "Continuous dark ridge silhouette behind the eastern landmarks.",
      },
    ],
    waterlines: [
      {
        points: [{ x: 0, y: 0.73 }, { x: 0.35, y: 0.66 }, { x: 0.68, y: 0.7 }, { x: 1, y: 0.78 }],
        evidence: "Harbor and open-water boundary remains visible across the lower composition.",
      },
    ],
    lightAndAtmosphere: [
      {
        signal: "Warm settlement lights against cold moonlit haze",
        depthImplication: "Contrast falls toward the distant island and colossus.",
      },
    ],
    ambiguities: [
      "Hidden backsides of the citadel and volcanic ridge are not visible.",
      "Absolute object scale is unverified without a measured image span.",
    ],
    coverageChecklist: {
      terrain: true,
      coastlines: true,
      settlements: true,
      fortifications: true,
      ports: true,
      boats: true,
      monuments: true,
      ruins: true,
      cemeteries: true,
      vegetation: false,
      lights: true,
      distantSilhouettes: true,
    },
  };
}
const projects = new Map<string, Project>([
  [
    "atlas-01",
    {
      id: "atlas-01",
      ownerId: "default",
      name: "ANA KARA / Moonlit Archipelago",
      imageName: "ANA_KARA_1788285065365.jpg",
      status: "ready",
      updatedAt: "2026-09-01T08:42:00.000Z",
      analysis: buildSeedAnalysis(),
    },
  ],
]);

const depthMapPngByProject = new Map<string, Buffer>();

function persistedProject(project: Project) {
  return {
    id: project.id,
    ownerId: project.ownerId,
    name: project.name,
    imageName: project.imageName,
    status: project.status,
    updatedAt: project.updatedAt,
    analysis: project.analysis,
    depthMapPreview: project.depthMapPreview ?? null,
    canonicalImageData: project.canonicalImageData ?? null,
    referenceImages: project.referenceImages ?? [],
    canonicalImagePath: project.canonicalImagePath ?? null,
    referenceImagePaths: project.referenceImagePaths ?? [],
    depthMapPreviewPath: project.depthMapPreviewPath ?? null,
    exportBundlePath: project.exportBundlePath ?? null,
  };
}

export async function hydrateProjects() {
  const persisted = await loadPersistedProjects();
  depthMapPngByProject.clear();
  if (persisted.length === 0) {
    for (const project of projects.values()) {
      await savePersistedProject(persistedProject(project));
    }
    return;
  }
  projects.clear();
  const depthPreviewHydrations: Promise<void>[] = [];
  for (const project of persisted) {
    if (!project.analysis || typeof project.analysis !== "object") continue;
    const analysis = project.analysis as Analysis;
    const hasPersistedRealAnalysis =
      analysis.calibrationEvidence?.canonicalImageSha256 !== undefined &&
      analysis.calibrationEvidence.canonicalImageSha256 !== "seed-analysis";
    const hydratedProject: Project = {
      id: project.id,
      ownerId: project.ownerId,
      name: project.name,
      imageName: project.imageName,
      status:
        project.status === "analyzing"
          ? hasPersistedRealAnalysis
            ? "ready"
            : "draft"
          : (project.status as Project["status"]),
      updatedAt: project.updatedAt,
      analysis,
      depthMapPreview: project.depthMapPreview ?? null,
      canonicalImageData: project.canonicalImageData ?? null,
      referenceImages: project.referenceImages ?? [],
      canonicalImagePath: project.canonicalImagePath ?? null,
      referenceImagePaths: project.referenceImagePaths ?? [],
      depthMapPreviewPath: project.depthMapPreviewPath ?? null,
      exportBundlePath: project.exportBundlePath ?? null,
    };
    projects.set(project.id, hydratedProject);
    if (project.depthMapPreview) {
      depthMapPngByProject.set(project.id, project.depthMapPreview);
    } else if (project.depthMapPreviewPath) {
      depthPreviewHydrations.push(
        readObjectBytes(project.ownerId, project.id, project.depthMapPreviewPath)
          .then((preview) => {
            hydratedProject.depthMapPreview = preview;
            depthMapPngByProject.set(project.id, preview);
          })
          .catch((error: unknown) => {
            logger.warn({ err: error, projectId: project.id }, "Could not restore depth preview from object storage");
          }),
      );
    } else if (analysis.denseDepth?.valuesBase64) {
      depthPreviewHydrations.push(
        renderDenseDepthPreview(analysis.denseDepth)
          .then((preview) => {
            if (preview) {
              hydratedProject.depthMapPreview = preview;
              depthMapPngByProject.set(project.id, preview);
            }
          })
          .catch((error: unknown) => {
            logger.warn(
              { err: error, projectId: project.id },
              "Could not rebuild persisted depth preview",
            );
          }),
      );
    }
  }
  await Promise.all(depthPreviewHydrations);
}

async function persistProject(project: Project) {
  await savePersistedProject(persistedProject(project));
}

function getProjectOr404(req: Request, res: Response): Project | undefined {
  const parsed = GetProjectParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid project id" });
    return undefined;
  }
  const project = projects.get(parsed.data.projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return undefined;
  }
  return project;
}

function toSummary(project: Project) {
  return {
    id: project.id,
    name: project.name,
    imageName: project.imageName,
    status: project.status,
    updatedAt: project.updatedAt,
    landmarkCount: project.analysis.landmarks.length,
    assetCount: project.analysis.assetTree.reduce(
      (total, asset) => total + asset.count,
      0,
    ),
    mapSize: `${Math.round(project.analysis.map.widthMeters / 1000)} × ${Math.round(project.analysis.map.depthMeters / 1000)} km`,
  };
}

function requireProjectSession(req: Request, res: Response, next: () => void) {
  if (isInternalRequest(req.header("x-worldforge-internal-token"))) {
    const ownerId = req.header("x-worldforge-owner-id");
    if (!ownerId) {
      res.status(401).json({ error: "Internal owner scope is required" });
      return;
    }
    req.worldForgeOwnerId = ownerId;
    next();
    return;
  }
  const ownerId = getSessionOwnerId(req);
  if (!ownerId) {
    res.status(401).json({ error: "Sign in to access projects" });
    return;
  }
  req.worldForgeOwnerId = ownerId;
  next();
}

function requireProjectOwner(req: Request, res: Response, next: () => void) {
  const project = projects.get(String(req.params["projectId"] ?? ""));
  if (!project || project.ownerId !== req.worldForgeOwnerId) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  next();
}

router.use("/projects", requireProjectSession);
router.use("/projects/:projectId", requireProjectOwner);

router.get("/projects", (req, res) => {
  res.json(Array.from(projects.values()).filter((project) => project.ownerId === req.worldForgeOwnerId).map(toSummary));
});

router.post("/projects", async (req, res) => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Project name and image name are required" });
    return;
  }
  if (!req.worldForgeOwnerId) {
    res.status(401).json({ error: "Sign in to create projects" });
    return;
  }
  const id = `world-${randomUUID()}`;
  const project: Project = {
    id,
    ownerId: req.worldForgeOwnerId,
    name: parsed.data.name,
    imageName: parsed.data.imageName,
    status: "draft",
    updatedAt: now(),
    analysis: buildSeedAnalysis(),
  };
  projects.set(id, project);
  try {
    await persistProject(project);
  } catch (error) {
    projects.delete(id);
    req.log.error({ err: error }, "Failed to persist new project");
    res.status(500).json({
      error: "Could not persist project",
      code: "PROJECT_PERSIST_FAILED",
      detail: error instanceof Error ? error.message : "Unknown persistence error",
    });
    return;
  }
  res.status(201).json(project);
});

router.get("/projects/:projectId", (req, res) => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const project = projects.get(params.data.projectId);
  if (project) res.json(project);
});

router.patch("/projects/:projectId", async (req, res) => {
  const params = UpdateProjectParams.safeParse(req.params);
  const body = UpdateProjectBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid project update" });
    return;
  }
  const project = projects.get(params.data.projectId);
  if (!project) return;
  if (body.data.status === "ready" && !hasCompletedAnalysis(project.analysis)) {
    res.status(409).json({
      error: "Cannot set status to ready without completed analysis",
      code: "ANALYSIS_REQUIRED",
    });
    return;
  }
  const updated: Project = {
    ...project,
    ...(body.data.name ? { name: body.data.name } : {}),
    ...(body.data.status ? { status: body.data.status } : {}),
    updatedAt: now(),
  };
  projects.set(params.data.projectId, updated);
  await persistProject(updated);
  res.json(updated);
});

router.post("/projects/:projectId/analysis", async (req, res) => {
  const params = AnalyzeProjectParams.safeParse(req.params);
  const body = AnalyzeProjectBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res
      .status(400)
      .json({ error: "A valid image and map calibration are required" });
    return;
  }
  const project = projects.get(params.data.projectId);
  if (!project) return;

  const previousAnalysis = project.analysis;
  const previousDepthMapPreview =
    project.depthMapPreview ?? depthMapPngByProject.get(params.data.projectId);
  project.status = "analyzing";
  project.updatedAt = now();
  await persistProject(project);

  const denseDepthPromise = generateDenseDepth(body.data.imageData);
  const geometryVerificationPromise = verifyImageGeometry(
    body.data.imageData,
    body.data.referenceImages ?? [],
  );
  const systemPrompt = `You are a senior technical art director and Unreal Engine 5 world builder. Analyze a concept image and return ONLY valid JSON matching this exact shape: {
    "confidence": number 0..1,
    "map": {"widthMeters": number, "depthMeters": number, "maxElevationMeters": number, "gridSizeMeters": number, "chunkCount": number, "origin": string, "coordinateSystem": string},
    "layers": [{"id": string, "name": string, "type": string, "coverage": number, "color": string, "notes": string}],
    "landmarks": [{"id": string, "sourceSurveyObjectId": string, "name": string, "type": string, "x": number, "y": number, "z": number, "rotation": number, "scale": number, "footprint": string, "confidence": number, "assetCount": number}],
    "assetTree": [{"id": string, "name": string, "parent": string, "category": string, "kind": string, "count": number, "productionCount": number, "placementCount": number, "isReusable": boolean, "dimensions": string, "dimensionsMeters": {"x": number, "y": number, "z": number}, "instruction": string, "sourcePrompt": string, "placementInstructions": string, "readEvidence": string, "placementPattern": {"type": "ellipse"|"arc", "center": {"x": number, "y": number, "z": number}, "radiusX": number, "radiusY": number, "startAngleDegrees": number, "endAngleDegrees": number, "closed": boolean, "alignToTangent": boolean, "rotationOffsetDegrees": number}, "placements": [{"id": string, "assetId": string, "parentLandmark": string, "x": number, "y": number, "z": number, "rotation": number, "orientation": {"yaw": number, "pitch": number, "roll": number}, "scale": number, "reason": string}]}],
    "validations": [{"id": string, "severity": "pass"|"warning"|"critical", "title": string, "detail": string}],
    "prompt": string
  }. Coordinates must be meters. Use the map center at sea-level as origin: +X points image-right/east, +Y points image-down/south, and +Z points upward. Negative X/Y values are valid west/north offsets. Rotation is yaw around +Z in degrees and scale is a unitless uniform multiplier.

  Perform an exhaustive three-pass scene read before producing JSON:
  1. MACRO: sea, coastline, islands, mountain ranges, volcanoes, snow, cliffs, valleys and major settlements.
  2. MID-SCALE: castles, fortified walls, towers, gates, domes/kümbets/mausoleums, temples, arenas, column ruins, cemeteries, harbors, piers, bridges, roads and stairs.
  3. SMALL-SCALE: boats and ships, sails, cranes, market props, grave stones, standing stones, lanterns, fires, braziers, lava channels, smoke, statues, vegetation and repeated silhouette families.

  Do not stop after detecting only the obvious terrain and central buildings. Every visually supported object family must become either a landmark or an assetTree entry. The user's reference specifically requires careful checks for kümbets/domeds tombs, docks/piers, boats, castles, towers and secondary ruins. Do not merge visually distinct families just to shorten the list: keep the kümbet/domed tomb separate from cemetery markers, the pier/quay separate from warehouses, boats separate from docks, castle walls separate from towers and gatehouses, and column ruins separate from lava/terrain. For each asset include readEvidence describing exactly what was visible in the image.

  Separate production from placement. productionCount is how many distinct meshes Rodin should generate. placementCount is how many instances Unreal should place. Identical repeated pieces must have productionCount=1 (or a small justified variant count) and multiple placement transforms. count must equal placementCount. isReusable is true when placementCount exceeds productionCount. dimensionsMeters is the authoritative local mesh extent X × Y × Z in meters; dimensions remains the human-readable description. rotation is the backward-compatible yaw value. orientation must provide yaw, pitch and roll for sloped or tilted placements and orientation.yaw must equal rotation. For circular, elliptical or semi-elliptical repeated structures such as arenas, curved walls, grave rows and colonnades, provide placementPattern. Angles are measured in the source XY plane from +X toward +Y; because +Y points south/image-down, increasing angles appear clockwise in the blueprint. Use type=ellipse for a closed 360° loop and type=arc for partial/semicircular runs. radiusX and radiusY are in meters. alignToTangent=true when modules should face along the curve. Include representative placements for review; the Unreal export deterministically expands a valid pattern to placementCount transforms.

  Treat the first image as the canonical composition and any additional images as alternate views of the same scene. For best results, the input set should be generated or captured as: View 1 — a wide master composition, straight-on, with the full environment and horizon visible; View 2 — a left three-quarter camera roughly 35–45 degrees from the master that reveals the near side of the city, walls and harbor; View 3 — a right three-quarter camera roughly 35–45 degrees from the master that reveals opposite faces and rear terrain. Preserve identical landmarks, materials, lighting language and relative scale across all views; do not redesign or add objects between angles. Use alternate views to resolve occlusion and relative depth, but never merge unrelated objects. For a single image, reconstruct a coherent 3D production hypothesis instead of merely listing visible objects: infer the horizon and vanishing directions, establish foreground/midground/background depth bands, build an occlusion graph, continue visible ridges and coastlines into conservative hidden terrain, and place every landmark in XYZ according to that shared camera hypothesis. Check that footprint, apparent size, overlap order and atmospheric depth agree with each coordinate. Infer conservatively: flag uncertain depth as warning in validations, never pretend a single image proves hidden geometry. For enterable structures, break the asset into editable parts such as foundations, floors, walls, columns, roofs/domes, doors, windows, stairs and interiors. Include at least 6 layers, 8 landmarks, 12 assetTree entries and 4 validations.`;

  try {
    const geometryVerification = await geometryVerificationPromise;
    const registeredAlternateHashes = new Set(
      geometryVerification.registrations
        .filter((registration) => registration.status === "registered")
        .map((registration) => registration.imageSha256),
    );
    const trustedReferenceImages = [...new Set(body.data.referenceImages ?? [])]
      .filter((imageData) => imageData !== body.data.imageData)
      .filter((imageData) =>
        registeredAlternateHashes.has(hashImageData(imageData)),
      );
    const uniqueImageCount = 1 + trustedReferenceImages.length;
    const geometryImages: GeometryImage[] = [
      body.data.imageData,
      ...trustedReferenceImages,
    ].map((imageData) => ({
      imageData,
      imageHash: hashImageData(imageData),
    }));
    const cameraGeometryVerificationPromise =
      runCameraGeometryVerification(geometryImages);
    const imageContent = [
      { type: "image_url" as const, image_url: { url: body.data.imageData } },
      ...trustedReferenceImages.map((url) => ({
        type: "image_url" as const,
        image_url: { url },
      })),
    ];
    const observationCompletion = await openai.chat.completions.create({
      model: "gpt-5.6-terra",
      max_completion_tokens: 6144,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are the visual geometry survey stage of a single-image 3D reconstruction pipeline. Return only JSON. Do not invent meters, world coordinates, hidden structures, or final asset counts. Extract normalized image-space evidence for the next stage:
{
  "cameraHypothesis": {
    "horizonY": number,
    "perspectiveStrength": "weak" | "medium" | "strong",
    "viewElevation": "low" | "eye-level" | "elevated" | "aerial",
    "vanishingDirections": [{"x": number, "y": number, "evidence": string}]
  },
  "depthBands": [{"id": string, "order": number, "range": "foreground" | "midground" | "background" | "distant", "evidence": string}],
  "objects": [{
    "id": string,
    "name": string,
    "category": string,
    "bbox": {"x": number, "y": number, "width": number, "height": number},
    "depthBand": string,
    "groundContact": {"x": number, "y": number},
    "occludes": [string],
    "occludedBy": [string],
    "visibleParts": [string],
    "repeatedPattern": string,
    "evidence": string,
    "confidence": number
  }],
  "terrainContours": [{"kind": string, "points": [{"x": number, "y": number}], "evidence": string}],
  "waterlines": [{"points": [{"x": number, "y": number}], "evidence": string}],
  "lightAndAtmosphere": [{"signal": string, "depthImplication": string}],
  "ambiguities": [string],
  "coverageChecklist": {
    "terrain": boolean, "coastlines": boolean, "settlements": boolean, "fortifications": boolean,
    "ports": boolean, "boats": boolean, "monuments": boolean, "ruins": boolean,
    "cemeteries": boolean, "vegetation": boolean, "lights": boolean, "distantSilhouettes": boolean
  }
}
All x/y/width/height values are normalized 0..1, bounding boxes must have positive size and remain fully inside the image, and contour/waterline paths need at least two points. Every occludes and occludedBy entry must use the exact id of another object in the objects array. Use visual overlap, contact points, atmospheric perspective, silhouette scale, waterline continuity and cast shadows. Separate visually distinct families. Mark ambiguity instead of resolving it by invention.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Survey the canonical concept image and ${Math.max(0, uniqueImageCount - 1)} alternate image(s). The canonical image defines composition; alternates may only confirm objects when they depict the same scene.`,
            },
            ...imageContent,
          ],
        },
      ],
    });
    const observationRaw = observationCompletion.choices[0]?.message?.content;
    if (!observationRaw) {
      throw new Error("The visual geometry survey returned an empty response");
    }

    const [denseDepth, cameraGeometryVerification] = await Promise.all([
      denseDepthPromise,
      cameraGeometryVerificationPromise,
    ]);
    const completion = await openai.chat.completions.create({
      model: "gpt-5.6-terra",
      max_completion_tokens: 16384,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Build the 3D production hypothesis from the visual geometry survey below.

Map calibration: width=${body.data.mapWidthMeters}m, depth=${body.data.mapDepthMeters}m, grid=${body.data.gridSizeMeters}m, known scale=${body.data.knownScale ?? "not provided"}m across ${body.data.knownScalePixelDistance ?? "unmeasured"} pixels. Preserve those map dimensions. Image 1 is canonical; ${Math.max(0, uniqueImageCount - 1)} unique additional image(s) are alternate views. Reported photogrammetry reprojection residual=${body.data.reprojectionErrorPixels ?? "not provided"}px; do not imply geometric validation when it is absent.

VISUAL GEOMETRY SURVEY:
${observationRaw}

Use the survey's normalized bounding boxes, ground-contact points, depth bands, terrain contours and occlusion graph as evidence. Every landmark derived from a survey object MUST copy that object's exact id into sourceSurveyObjectId; do not translate, rename or invent this provenance id. Resolve a single coherent camera/world hypothesis. If the requested map scale conflicts with visible ratios, preserve the map envelope but increase landmark uncertainty and add a validation warning. Do not drop survey objects merely because they are secondary.`,
            },
            ...imageContent,
          ],
        },
      ],
    });
    let raw = completion.choices[0]?.message?.content;
    if (!raw) {
      req.log.warn(
        "Full visual synthesis returned empty; retrying from the geometry survey",
      );
      const retryCompletion = await openai.chat.completions.create({
        model: "gpt-5.6-terra",
        max_completion_tokens: 16384,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `${systemPrompt}

This is a recovery pass. Produce a compact but complete response. Use short evidence and instruction strings. Preserve all required arrays and numeric fields. Do not repeat prose outside the JSON.`,
          },
          {
            role: "user",
            content: `Create the final world specification from this completed visual geometry survey. Map width=${body.data.mapWidthMeters}m, depth=${body.data.mapDepthMeters}m, grid=${body.data.gridSizeMeters}m. No independent scale calibration is available unless explicitly present below.

${observationRaw}`,
          },
        ],
      });
      raw = retryCompletion.choices[0]?.message?.content;
    }
    if (!raw)
      throw new Error(
        "The 3D synthesis stage returned an empty response after retry",
      );
    const parsedJson: unknown = JSON.parse(
      raw.replace(/^```json\s*|\s*```$/g, ""),
    );
    const validated = AnalyzeProjectResponse.safeParse(parsedJson);
    if (!validated.success)
      throw new Error(
        "The analysis model returned an invalid world specification",
      );
    const modelAnalysis = validated.data as Analysis;
    const calibratedAnalysis: Analysis = {
      ...modelAnalysis,
      geometryVerification,
      map: {
        ...modelAnalysis.map,
        widthMeters: body.data.mapWidthMeters,
        depthMeters: body.data.mapDepthMeters,
        gridSizeMeters: body.data.gridSizeMeters,
        chunkCount:
          Math.ceil(body.data.mapWidthMeters / 1024) *
          Math.ceil(body.data.mapDepthMeters / 1024),
        origin: "Map center at sea-level datum · X east / Y south / Z up",
        coordinateSystem:
          "World Forge meters · Unreal-compatible left-handed Z-up · export ×100cm",
      },
    };

    const depthAnnotatedAnalysis = attachDepthEvidence(
      calibratedAnalysis,
      observationRaw,
      denseDepth,
    );
    const surveyAuditedAnalysis = attachSurveyAudit(
      attachVisualSurvey(depthAnnotatedAnalysis, observationRaw),
      observationRaw,
    );
    project.analysis = enrichAnalysis(surveyAuditedAnalysis, {
      hasKnownScale:
        typeof body.data.knownScale === "number" && body.data.knownScale > 0,
      hasPixelCalibration:
        typeof body.data.knownScale === "number" &&
        body.data.knownScale > 0 &&
        typeof body.data.knownScalePixelDistance === "number" &&
        body.data.knownScalePixelDistance >= 10,
      imageCount: uniqueImageCount,
      reprojectionErrorPixels:
        typeof body.data.reprojectionErrorPixels === "number"
          ? body.data.reprojectionErrorPixels
          : undefined,
      canonicalImageSha256: hashImageData(body.data.imageData),
      alternateImageSha256s: trustedReferenceImages.map(hashImageData),
      knownScaleMeters:
        typeof body.data.knownScale === "number" ? body.data.knownScale : null,
      knownScalePixelDistance:
        typeof body.data.knownScalePixelDistance === "number"
          ? body.data.knownScalePixelDistance
          : null,
      denseDepthStatus: denseDepth.status,
      cameraGeometryVerification,
    });
    const depthPreview = await renderDenseDepthPreview(denseDepth);
    if (depthPreview) {
      depthMapPngByProject.set(params.data.projectId, depthPreview);
      project.depthMapPreview = depthPreview;
      project.analysis.depthMap = {
        status: "ready",
        provider: denseDepth.provider,
        model: denseDepth.model,
        relativeOnly: denseDepth.depthUnit === "relative",
        width: denseDepth.width,
        height: denseDepth.height,
        min: denseDepth.minDepth ?? undefined,
        max: denseDepth.maxDepth ?? undefined,
        sourceImageSha256: denseDepth.inputImageSha256,
        previewUrl: `/api/projects/${params.data.projectId}/depth-map`,
      };
    } else {
      project.depthMapPreview = null;
      depthMapPngByProject.delete(params.data.projectId);
      project.analysis.depthMap = {
        status: "unavailable",
        provider: denseDepth.provider,
        model: denseDepth.model,
        relativeOnly: denseDepth.depthUnit === "relative",
        sourceImageSha256: denseDepth.inputImageSha256,
        error: denseDepth.failureReason ?? "Depth preview unavailable",
      };
      project.analysis.validations = [
        ...project.analysis.validations,
        {
          id: "depth-adapter",
          severity: "warning",
          title: "Dense depth adapter was unavailable",
          detail: `${denseDepth.failureReason ?? "Depth preview unavailable"}. The visual geometry survey remains active.`,
        },
      ];
    }
    project.status = "ready";
    project.updatedAt = now();
    projects.set(params.data.projectId, project);
    await persistProject(project);
    res.json(project.analysis);
  } catch (error) {
    project.analysis = previousAnalysis;
    project.depthMapPreview = previousDepthMapPreview ?? null;
    if (previousDepthMapPreview) {
      depthMapPngByProject.set(params.data.projectId, previousDepthMapPreview);
    } else {
      depthMapPngByProject.delete(params.data.projectId);
    }
    project.status = previousAnalysis ? "ready" : "draft";
    project.updatedAt = now();
    await persistProject(project);
    req.log.error({ err: error }, "Concept image analysis failed");
    res.status(502).json({
      error: error instanceof Error ? error.message : "Analysis failed",
      preservedExistingAnalysis: Boolean(previousAnalysis),
    });
  }
});

router.get("/projects/:projectId/summary", (req, res) => {
  const params = ExportProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const project = projects.get(params.data.projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(toSummary(project));
});

router.get("/projects/:projectId/depth-map", (req, res) => {
  const projectId = String(req.params["projectId"] ?? "");
  const png = depthMapPngByProject.get(projectId);
  if (!png) {
    res.status(404).json({ error: "Depth map not available" });
    return;
  }
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-store");
  res.send(png);
});

router.get("/projects/:projectId/export", (req, res) => {
  const params = ExportProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const project = projects.get(params.data.projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const readiness = computeExportReadiness(project.analysis);
  const draftRequested =
    req.query.draft === "1" ||
    req.query.draft === "true" ||
    String(req.query.mode ?? "").toLowerCase() === "draft";
  if (!readiness.exportReadyCm) {
    if (!draftRequested || !readiness.exportReadyDraft) {
      res.status(409).json({
        code: "EXPORT_NOT_SCALE_LOCKED",
        tier: readiness.tier,
        failingChecks: readiness.failingChecks,
        message:
          "Full Unreal centimeter export requires scale-locked camera geometry (verified pose + metric scale). Pass ?draft=1 for an unscaled draft bundle.",
      });
      return;
    }
    res.json(
      buildUnrealExportBundle(project, now(), {
        draft: true,
        tier: readiness.tier,
        failingChecks: readiness.failingChecks,
      }),
    );
    return;
  }
  res.json(
    buildUnrealExportBundle(project, now(), {
      draft: false,
      tier: readiness.tier,
      failingChecks: readiness.failingChecks,
    }),
  );
});

export default router;

function parseSurveyObjects(raw: string): SurveyObject[] {
  try {
    const parsed: unknown = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ""));
    if (!parsed || typeof parsed !== "object") return [];
    const survey = parsed as { objects?: unknown; depthBands?: unknown };
    const objects = survey.objects;
    if (!Array.isArray(objects)) return [];
    const depthBandRanges = new Map<string, string>();
    if (Array.isArray(survey.depthBands)) {
      for (const item of survey.depthBands) {
        if (!item || typeof item !== "object") continue;
        const band = item as { id?: unknown; range?: unknown };
        if (typeof band.id === "string" && typeof band.range === "string") {
          depthBandRanges.set(band.id, band.range);
        }
      }
    }
    return objects.filter((object): object is SurveyObject =>
      Boolean(object && typeof object === "object"),
    ).map((object) => ({
      ...object,
      depthBand:
        (object.depthBand && depthBandRanges.get(object.depthBand)) ??
        object.depthBand,
    }));
  } catch {
    return [];
  }
}
function attachSurveyAudit(analysis: Analysis, surveyRaw: string): Analysis {
  const objects = parseSurveyObjects(surveyRaw);
  const ids = objects
    .map((object) => object.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const uniqueIds = new Set(ids);
  const linkedIds = new Set(
    analysis.landmarks
      .map((landmark) => landmark.sourceSurveyObjectId)
      .filter(
        (id): id is string =>
          typeof id === "string" && uniqueIds.has(id),
      ),
  );
  const invalidGeometryCount = objects.filter((object) => {
    const bbox = object.bbox;
    const contact = object.groundContact;
    const validBbox =
      bbox &&
      [bbox.x, bbox.y, bbox.width, bbox.height].every(
        (value) => typeof value === "number" && Number.isFinite(value),
      ) &&
      (bbox.x ?? -1) >= 0 &&
      (bbox.y ?? -1) >= 0 &&
      (bbox.width ?? 0) > 0 &&
      (bbox.height ?? 0) > 0 &&
      (bbox.x ?? 0) + (bbox.width ?? 0) <= 1 &&
      (bbox.y ?? 0) + (bbox.height ?? 0) <= 1;
    const validContact =
      contact &&
      typeof contact.x === "number" &&
      typeof contact.y === "number" &&
      contact.x >= 0 &&
      contact.x <= 1 &&
      contact.y >= 0 &&
      contact.y <= 1;
    return !validBbox || !validContact;
  }).length;
  const unlinkedLandmarkCount = analysis.landmarks.filter(
    (landmark) =>
      !landmark.sourceSurveyObjectId ||
      !uniqueIds.has(landmark.sourceSurveyObjectId),
  ).length;
  const missingSurveyObjectCount = [...uniqueIds].filter(
    (id) => !linkedIds.has(id),
  ).length;
  const duplicateIdCount = ids.length - uniqueIds.size;
  const hasIssues =
    objects.length === 0 ||
    invalidGeometryCount > 0 ||
    unlinkedLandmarkCount > 0 ||
    missingSurveyObjectCount > 0 ||
    duplicateIdCount > 0;
  const notes = [
    `${linkedIds.size}/${uniqueIds.size} unique survey objects are linked to synthesized landmarks.`,
    invalidGeometryCount > 0
      ? `${invalidGeometryCount} survey objects have invalid normalized bounds or ground-contact coordinates.`
      : "All survey object bounds and ground-contact coordinates are normalized and valid.",
    duplicateIdCount > 0
      ? `${duplicateIdCount} duplicate survey object IDs require review.`
      : "Survey object IDs are unique.",
  ];
  return {
    ...analysis,
    surveyAudit: {
      status: hasIssues ? "review-required" : "pass",
      objectCount: objects.length,
      uniqueObjectCount: uniqueIds.size,
      linkedLandmarkCount: linkedIds.size,
      unlinkedLandmarkCount,
      missingSurveyObjectCount,
      invalidGeometryCount,
      duplicateIdCount,
      notes,
    },
  };
}

function attachDepthEvidence(
  analysis: Analysis,
  surveyRaw: string,
  depth: DenseDepthArtifact,
): Analysis {
  const objects = parseSurveyObjects(surveyRaw);
  if (depth.status !== "ready") {
    return {
      ...analysis,
      denseDepth: depth,
      landmarks: analysis.landmarks.map((landmark) => ({
        ...landmark,
        depthEvidence: {
          depthBand: "unknown",
          normalizedDepth: null,
          depthMeters: null,
          uncertaintyMeters: null,
          visualUncertaintyMeters: landmark.uncertaintyMeters ?? null,
          uncertaintyRatio: null,
          uncertaintyCrossCheck: "unavailable",
          sampleCount: 0,
          crossCheck: "unavailable",
          source: "dense-depth",
        },
      })),
    };
  }
  const landmarks = analysis.landmarks.map((landmark) => {
    const surveyObject = matchSurveyObject(landmark, objects);
    const bbox = surveyObject?.bbox;
    const x =
      typeof surveyObject?.groundContact?.x === "number"
        ? surveyObject.groundContact.x
        : typeof bbox?.x === "number" && typeof bbox?.width === "number"
          ? bbox.x + bbox.width / 2
          : null;
    const y =
      typeof surveyObject?.groundContact?.y === "number"
        ? surveyObject.groundContact.y
        : typeof bbox?.y === "number" && typeof bbox?.height === "number"
          ? bbox.y + bbox.height
          : null;
    const declaredBand = [
      "foreground",
      "midground",
      "background",
      "distant",
    ].includes(surveyObject?.depthBand ?? "")
      ? (surveyObject?.depthBand as DepthBand)
      : undefined;
    const hasValidCoordinates =
      x !== null && y !== null && x >= 0 && x <= 1 && y >= 0 && y <= 1;
    const sample = hasValidCoordinates
      ? sampleDenseDepth(depth, x, y, analysis.map.depthMeters)
      : null;
    if (!sample || !declaredBand) {
      return {
        ...landmark,
        depthEvidence: {
          depthBand: "unknown" as const,
          normalizedDepth: null,
          depthMeters: null,
          uncertaintyMeters: null,
          visualUncertaintyMeters: landmark.uncertaintyMeters ?? null,
          uncertaintyRatio: null,
          uncertaintyCrossCheck: "unavailable" as const,
          sampleCount: 0,
          crossCheck: "unavailable" as const,
          source: "dense-depth" as const,
        },
      };
    }
    const inferredBand = inferDepthBand(sample.normalizedDepth);
    const depthUncertaintyMeters =
      sample.uncertaintyMeters === null
        ? null
        : round(sample.uncertaintyMeters);
    const visualUncertaintyMeters =
      landmark.uncertaintyMeters ??
      round(
        Math.max(
          analysis.map.gridSizeMeters * 0.25,
          (1 - landmark.confidence) *
            Math.max(analysis.map.widthMeters, analysis.map.depthMeters) *
            0.08,
        ),
      );
    const uncertaintyComparison =
      depthUncertaintyMeters === null
        ? null
        : compareDepthUncertainty(
            visualUncertaintyMeters,
            depthUncertaintyMeters,
          );
    const uncertaintyRatio = uncertaintyComparison?.ratio ?? null;
    const uncertaintyCrossCheck =
      uncertaintyComparison?.status ?? ("unavailable" as const);
    const bandOrder: Record<DepthBand, number> = {
      foreground: 0,
      midground: 1,
      background: 2,
      distant: 3,
    };
    const bandDistance = Math.abs(
      bandOrder[declaredBand] - bandOrder[inferredBand],
    );
    const bandCrossCheck =
      bandDistance === 0
        ? ("supported" as const)
        : bandDistance === 1
          ? ("nearby" as const)
          : ("review-required" as const);
    return {
      ...landmark,
      uncertaintyMeters: Math.max(
        visualUncertaintyMeters,
        depthUncertaintyMeters ?? 0,
      ),
      depthEvidence: {
        depthBand: declaredBand,
        normalizedDepth: round(sample.normalizedDepth, 4),
        depthMeters: sample.depthMeters,
        uncertaintyMeters: depthUncertaintyMeters,
        visualUncertaintyMeters,
        uncertaintyRatio,
        uncertaintyCrossCheck,
        sampleCount: sample.sampleCount,
        crossCheck:
          bandCrossCheck === "review-required" ||
          uncertaintyCrossCheck === "review-required"
            ? ("review-required" as const)
            : bandCrossCheck,
        source: "dense-depth" as const,
      },
    };
  });
  return { ...analysis, denseDepth: depth, landmarks };
}

function inferDepthBand(normalizedDepth: number): DepthBand {
  if (normalizedDepth < 0.25) return "foreground";
  if (normalizedDepth < 0.5) return "midground";
  if (normalizedDepth < 0.75) return "background";
  return "distant";
}

function matchSurveyObject(
  landmark: Analysis["landmarks"][number],
  objects: SurveyObject[],
) {
  if (landmark.sourceSurveyObjectId) {
    const exact = objects.find(
      (object) => object.id === landmark.sourceSurveyObjectId,
    );
    if (exact) return exact;
  }
  const landmarkText = normalizeSearchText(
    `${landmark.id} ${landmark.name} ${landmark.type}`,
  );
  const landmarkTokens = new Set(
    landmarkText.split(/\s+/).filter((token) => token.length > 2),
  );
  const best = objects
    .map((object) => {
      const objectText = normalizeSearchText(
        `${object.id ?? ""} ${object.name ?? ""} ${object.category ?? ""}`,
      );
      const score = Array.from(landmarkTokens).reduce(
        (total, token) => total + (objectText.includes(token) ? 1 : 0),
        0,
      );
      return { object, score };
    })
    .sort((left, right) => right.score - left.score)[0];
  return best && best.score > 0 ? best.object : undefined;
}

function normalizeSearchText(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9ğüşöçıİĞÜŞÖÇ]+/gi, " ");
}


function attachVisualSurvey(analysis: Analysis, surveyRaw: string): Analysis {
  const result = parseVisualSurvey(surveyRaw);
  if (result.success) return { ...analysis, visualSurvey: result.data };
  return {
    ...analysis,
    validations: [
      ...analysis.validations,
      {
        id: "visual-survey-invalid",
        severity: "warning",
        title: "Visual survey evidence was rejected",
        detail: `The survey was not retained because it failed typed evidence validation: ${result.error}`,
      },
    ],
  };
}

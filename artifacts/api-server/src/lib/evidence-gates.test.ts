import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  type CameraGeometryVerification,
  isVerifiedCameraGeometry,
} from "./camera-geometry";
import {
  computeExportReadiness,
  hasCompletedAnalysis,
  hasMetricScale,
} from "./evidence-gates";
import { perceptualImageSimilarity } from "./geometry-verifier";

const toDataUrl = (mime: string, bytes: Buffer) =>
  `data:${mime};base64,${bytes.toString("base64")}`;

test("rejects re-encoded views as perceptual duplicates", async () => {
  const width = 96;
  const height = 64;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      pixels[offset] = Math.round((x / width) * 255);
      pixels[offset + 1] = Math.round((y / height) * 255);
      pixels[offset + 2] = (x * 7 + y * 13) % 255;
    }
  }
  const source = sharp(pixels, { raw: { width, height, channels: 3 } });
  const png = await source.clone().png().toBuffer();
  const jpeg = await source.clone().jpeg({ quality: 82 }).toBuffer();
  const similarity = await perceptualImageSimilarity(
    toDataUrl("image/png", png),
    toDataUrl("image/jpeg", jpeg),
  );
  assert.ok(similarity >= 0.985, `expected duplicate similarity, got ${similarity}`);
});

function cameraGeometry(
  cameraCenters: number[][],
): CameraGeometryVerification {
  const imageHashes = ["image-a", "image-b", "image-c"];
  const pointTracks = Array.from({ length: 12 }, (_, index) => ({
    id: `track-${index}`,
    xyz: [(index % 4) - 1.5, Math.floor(index / 4) - 1, 20 + (index % 3)],
    observations: imageHashes.map((imageHash) => ({
      imageHash,
      x: 320,
      y: 240,
      residualPixels: 0.1,
    })),
  }));
  return {
    status: "verified",
    imageHashes,
    proposal: {
      provider: "vggt",
      model: "test",
      version: "1",
      status: "ready",
      cameraIntrinsics: [],
      cameraExtrinsics: [],
      pointTracks: [],
    },
    solver: "colmap",
    solverVersion: "test",
    cameraIntrinsics: imageHashes.map((imageHash) => ({
      imageHash,
      width: 640,
      height: 480,
      fx: 500,
      fy: 500,
      cx: 320,
      cy: 240,
      distortion: [],
    })),
    cameraExtrinsics: imageHashes.map((imageHash, index) => ({
      imageHash,
      rotation: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      translation: [0, 0, 0],
      cameraCenter: cameraCenters[index] ?? [0, 0, 0],
    })),
    pointTracks,
    inlierCount: 36,
    residualDistribution: {
      totalCount: 36,
      inlierCount: 36,
      outlierCount: 0,
      inlierThresholdPixels: 1,
      meanPixels: 0.1,
      medianPixels: 0.1,
      rmsPixels: 0.1,
      p95Pixels: 0.1,
      maxPixels: 0.1,
    },
    serverComputedResiduals: true,
  };
}

test("keeps the 99% camera gate locked for zero-baseline views", () => {
  assert.equal(
    isVerifiedCameraGeometry(
      cameraGeometry([
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ]),
      3,
    ),
    false,
  );
});

test("accepts genuinely separated cameras with triangulation angle", () => {
  assert.equal(
    isVerifiedCameraGeometry(
      cameraGeometry([
        [-2, 0, 0],
        [0, 0, 0],
        [2, 0, 0],
      ]),
      3,
    ),
    true,
  );
});

test("export readiness stays draft without verified camera geometry", () => {
  const analysis = {
    confidence: 0.8,
    map: { widthMeters: 100 },
    landmarks: [{ id: "a" }],
    assetTree: [{ id: "b" }],
    validations: [],
    calibrationEvidence: {
      knownScaleMeters: 20,
      knownScalePixelDistance: 140,
      alternateImageSha256s: ["x", "y"],
    },
    cameraGeometryVerification: cameraGeometry([
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]),
  };
  analysis.cameraGeometryVerification.status = "rejected";
  const readiness = computeExportReadiness(analysis as never);
  assert.equal(readiness.tier, "draft");
  assert.equal(readiness.exportReadyCm, false);
  assert.equal(readiness.exportReadyDraft, true);
  assert.ok(readiness.failingChecks.includes("camera-geometry-unverified"));
});

test("export readiness reaches scale-locked only with pose + metric scale", () => {
  const analysis = {
    confidence: 0.91,
    map: { widthMeters: 100 },
    landmarks: [{ id: "a" }],
    assetTree: [{ id: "b" }],
    validations: [],
    calibrationEvidence: {
      knownScaleMeters: 20,
      knownScalePixelDistance: 140,
      alternateImageSha256s: ["x", "y"],
    },
    cameraGeometryVerification: cameraGeometry([
      [-2, 0, 0],
      [0, 0, 0],
      [2, 0, 0],
    ]),
  };
  assert.equal(hasCompletedAnalysis(analysis as never), true);
  assert.equal(hasMetricScale(analysis as never), true);
  const readiness = computeExportReadiness(analysis as never);
  assert.equal(readiness.tier, "scale-locked");
  assert.equal(readiness.exportReadyCm, true);
  assert.equal(readiness.exportReady, true);
  assert.deepEqual(readiness.failingChecks, []);
});

test("verified without metric scale is not cm-exportable", () => {
  const analysis = {
    confidence: 0.9,
    map: { widthMeters: 100 },
    landmarks: [{ id: "a" }],
    assetTree: [{ id: "b" }],
    validations: [],
    calibrationEvidence: {
      knownScaleMeters: null,
      knownScalePixelDistance: null,
      alternateImageSha256s: ["x", "y"],
    },
    cameraGeometryVerification: cameraGeometry([
      [-2, 0, 0],
      [0, 0, 0],
      [2, 0, 0],
    ]),
  };
  const readiness = computeExportReadiness(analysis as never);
  assert.equal(readiness.tier, "verified");
  assert.equal(readiness.exportReadyCm, false);
  assert.ok(readiness.failingChecks.includes("metric-scale-unknown"));
});

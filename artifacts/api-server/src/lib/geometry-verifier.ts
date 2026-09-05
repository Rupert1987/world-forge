import { createHash } from "node:crypto";
import sharp from "sharp";

export type ViewRegistration = {
  imageSha256: string;
  status: "registered" | "rejected" | "failed";
  keypointCountCanonical: number;
  keypointCountAlternate: number;
  candidateMatchCount: number;
  inlierCount: number;
  inlierRatio: number;
  reprojectionRmsPixels: number | null;
  homography: number[] | null;
  reason: string;
};

export type GeometryVerification = {
  status:
    | "not-requested"
    | "insufficient-verified-views"
    | "views-registered"
    | "solver-verified";
  solver: "opencv-orb-homography" | "configured-camera-solver";
  solverVersion: string;
  canonicalImageSha256: string;
  requestedAlternateViewCount: number;
  verifiedAlternateViewCount: number;
  cameraPoseVerified: boolean;
  aggregateReprojectionRmsPixels: number | null;
  registrations: ViewRegistration[];
  notes: string[];
};

// OpenCV.js ships runtime-generated WASM bindings whose declaration module does
// not model its Promise-returning default export consistently.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CvRuntime = any;

let cvPromise: Promise<CvRuntime> | undefined;
const PERCEPTUAL_DUPLICATE_SIMILARITY = 0.985;

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

async function getCv() {
  cvPromise ??= import("@techstark/opencv-js").then(async ({ default: module }) =>
    module instanceof Promise ? module : module,
  );
  return cvPromise;
}

function decodeDataUrl(value: string) {
  const match = value.match(/^data:[^;]+;base64,(.+)$/s);
  if (!match) throw new Error("Geometry verifier requires base64 image data");
  return Buffer.from(match[1], "base64");
}

async function perceptualVector(imageData: string) {
  const { data } = await sharp(decodeDataUrl(imageData))
    .resize({ width: 32, height: 32, fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

function vectorSimilarity(left: Buffer, right: Buffer) {
  const length = Math.min(left.length, right.length);
  if (length === 0) return 0;
  let leftMean = 0;
  let rightMean = 0;
  let absoluteDifference = 0;
  for (let index = 0; index < length; index += 1) {
    leftMean += left[index] ?? 0;
    rightMean += right[index] ?? 0;
    absoluteDifference += Math.abs((left[index] ?? 0) - (right[index] ?? 0));
  }
  leftMean /= length;
  rightMean /= length;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    const leftValue = (left[index] ?? 0) - leftMean;
    const rightValue = (right[index] ?? 0) - rightMean;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  const correlation =
    leftNorm > 0 && rightNorm > 0
      ? dot / Math.sqrt(leftNorm * rightNorm)
      : leftMean === rightMean
        ? 1
        : 0;
  const luminanceSimilarity = 1 - absoluteDifference / (length * 255);
  return Math.max(0, Math.min(1, Math.max(correlation, luminanceSimilarity)));
}

export async function perceptualImageSimilarity(
  leftImageData: string,
  rightImageData: string,
) {
  const [left, right] = await Promise.all([
    perceptualVector(leftImageData),
    perceptualVector(rightImageData),
  ]);
  return vectorSimilarity(left, right);
}

async function toGrayMat(cv: CvRuntime, imageData: string) {
  const { data, info } = await sharp(decodeDataUrl(imageData))
    .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const gray = new Uint8Array(info.width * info.height);
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * info.channels;
    gray[index] = Math.round(
      data[offset] * 0.299 +
        data[offset + 1] * 0.587 +
        data[offset + 2] * 0.114,
    );
  }
  return cv.matFromArray(info.height, info.width, cv.CV_8UC1, gray);
}

function project(homography: number[], x: number, y: number) {
  const denominator =
    homography[6] * x + homography[7] * y + homography[8];
  if (Math.abs(denominator) < Number.EPSILON) return null;
  return {
    x: (homography[0] * x + homography[1] * y + homography[2]) / denominator,
    y: (homography[3] * x + homography[4] * y + homography[5]) / denominator,
  };
}

async function registerView(
  canonicalImage: string,
  alternateImage: string,
): Promise<ViewRegistration> {
  const cv = await getCv();
  const resources: Array<{ delete(): void }> = [];
  try {
    const canonical = await toGrayMat(cv, canonicalImage);
    const alternate = await toGrayMat(cv, alternateImage);
    const canonicalKeypoints = new cv.KeyPointVector();
    const alternateKeypoints = new cv.KeyPointVector();
    const canonicalDescriptors = new cv.Mat();
    const alternateDescriptors = new cv.Mat();
    const emptyMask = new cv.Mat();
    const orb = new cv.ORB(1200);
    const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
    const matches = new cv.DMatchVectorVector();
    resources.push(
      canonical,
      alternate,
      canonicalKeypoints,
      alternateKeypoints,
      canonicalDescriptors,
      alternateDescriptors,
      emptyMask,
      orb,
      matcher,
      matches,
    );
    orb.detectAndCompute(
      canonical,
      emptyMask,
      canonicalKeypoints,
      canonicalDescriptors,
    );
    orb.detectAndCompute(
      alternate,
      emptyMask,
      alternateKeypoints,
      alternateDescriptors,
    );
    if (
      canonicalDescriptors.rows < 20 ||
      alternateDescriptors.rows < 20
    ) {
      return {
        imageSha256: hash(alternateImage),
        status: "rejected",
        keypointCountCanonical: canonicalKeypoints.size(),
        keypointCountAlternate: alternateKeypoints.size(),
        candidateMatchCount: 0,
        inlierCount: 0,
        inlierRatio: 0,
        reprojectionRmsPixels: null,
        homography: null,
        reason: "Not enough visual keypoints for geometric registration.",
      };
    }
    matcher.knnMatch(
      canonicalDescriptors,
      alternateDescriptors,
      matches,
      2,
    );
    const goodMatches: Array<{
      queryIdx: number;
      trainIdx: number;
    }> = [];
    for (let index = 0; index < matches.size(); index += 1) {
      const neighbors = matches.get(index);
      if (neighbors.size() < 2) continue;
      const best = neighbors.get(0);
      const second = neighbors.get(1);
      if (best.distance < second.distance * 0.75) {
        goodMatches.push(best);
      }
    }
    if (goodMatches.length < 12) {
      return {
        imageSha256: hash(alternateImage),
        status: "rejected",
        keypointCountCanonical: canonicalKeypoints.size(),
        keypointCountAlternate: alternateKeypoints.size(),
        candidateMatchCount: goodMatches.length,
        inlierCount: 0,
        inlierRatio: 0,
        reprojectionRmsPixels: null,
        homography: null,
        reason: "Too few ratio-tested feature matches.",
      };
    }
    const sourcePoints: number[] = [];
    const targetPoints: number[] = [];
    for (const match of goodMatches) {
      const source = canonicalKeypoints.get(match.queryIdx).pt;
      const target = alternateKeypoints.get(match.trainIdx).pt;
      sourcePoints.push(source.x, source.y);
      targetPoints.push(target.x, target.y);
    }
    const sourceMat = cv.matFromArray(
      goodMatches.length,
      1,
      cv.CV_32FC2,
      sourcePoints,
    );
    const targetMat = cv.matFromArray(
      goodMatches.length,
      1,
      cv.CV_32FC2,
      targetPoints,
    );
    const inlierMask = new cv.Mat();
    resources.push(sourceMat, targetMat, inlierMask);
    const homographyMat = cv.findHomography(
      sourceMat,
      targetMat,
      cv.RANSAC,
      3,
      inlierMask,
    );
    resources.push(homographyMat);
    const homography = Array.from(
      homographyMat.data64F ?? [],
      (value) => Number(value),
    ).slice(0, 9);
    if (homography.length !== 9) {
      throw new Error("RANSAC did not produce a valid homography");
    }
    let inlierCount = 0;
    let squaredError = 0;
    for (let index = 0; index < goodMatches.length; index += 1) {
      if (!inlierMask.data[index]) continue;
      const projected = project(
        homography,
        sourcePoints[index * 2],
        sourcePoints[index * 2 + 1],
      );
      if (!projected) continue;
      const dx = projected.x - targetPoints[index * 2];
      const dy = projected.y - targetPoints[index * 2 + 1];
      squaredError += dx * dx + dy * dy;
      inlierCount += 1;
    }
    const inlierRatio = inlierCount / goodMatches.length;
    const rms =
      inlierCount > 0 ? Math.sqrt(squaredError / inlierCount) : null;
    const registered =
      inlierCount >= 24 && inlierRatio >= 0.35 && rms !== null && rms <= 3;
    return {
      imageSha256: hash(alternateImage),
      status: registered ? "registered" : "rejected",
      keypointCountCanonical: canonicalKeypoints.size(),
      keypointCountAlternate: alternateKeypoints.size(),
      candidateMatchCount: goodMatches.length,
      inlierCount,
      inlierRatio: Math.round(inlierRatio * 1000) / 1000,
      reprojectionRmsPixels:
        rms === null ? null : Math.round(rms * 1000) / 1000,
      homography,
      reason: registered
        ? "Same-scene image registration passed ORB matching and RANSAC checks."
        : "RANSAC registration did not meet inlier and residual thresholds.",
    };
  } catch (error) {
    return {
      imageSha256: hash(alternateImage),
      status: "failed",
      keypointCountCanonical: 0,
      keypointCountAlternate: 0,
      candidateMatchCount: 0,
      inlierCount: 0,
      inlierRatio: 0,
      reprojectionRmsPixels: null,
      homography: null,
      reason:
        error instanceof Error ? error.message : "Geometry registration failed.",
    };
  } finally {
    for (const resource of resources.reverse()) resource.delete();
  }
}

export async function verifyImageGeometry(
  canonicalImage: string,
  alternateImages: string[],
): Promise<GeometryVerification> {
  const uniqueAlternates = [...new Set(alternateImages)].filter(
    (image) => image !== canonicalImage,
  );
  if (uniqueAlternates.length === 0) {
    return {
      status: "not-requested",
      solver: "opencv-orb-homography",
      solverVersion: "opencv-js-5.0.0",
      canonicalImageSha256: hash(canonicalImage),
      requestedAlternateViewCount: 0,
      verifiedAlternateViewCount: 0,
      cameraPoseVerified: false,
      aggregateReprojectionRmsPixels: null,
      registrations: [],
      notes: [
        "No genuine alternate views were supplied; camera geometry remains single-view.",
      ],
    };
  }
  const registrations: ViewRegistration[] = [];
  const acceptedImages = [canonicalImage];
  for (const image of uniqueAlternates) {
    const similarities = await Promise.all(
      acceptedImages.map((accepted) =>
        perceptualImageSimilarity(accepted, image),
      ),
    );
    const maximumSimilarity = Math.max(...similarities);
    if (maximumSimilarity >= PERCEPTUAL_DUPLICATE_SIMILARITY) {
      registrations.push({
        imageSha256: hash(image),
        status: "rejected",
        keypointCountCanonical: 0,
        keypointCountAlternate: 0,
        candidateMatchCount: 0,
        inlierCount: 0,
        inlierRatio: 0,
        reprojectionRmsPixels: null,
        homography: null,
        reason: `Perceptual duplicate rejected (${maximumSimilarity.toFixed(4)} similarity); this view adds no camera baseline.`,
      });
      continue;
    }
    const registration = await registerView(canonicalImage, image);
    registrations.push(registration);
    if (registration.status === "registered") acceptedImages.push(image);
  }
  const verified = registrations.filter(
    (registration) => registration.status === "registered",
  );
  const residuals = verified
    .map((registration) => registration.reprojectionRmsPixels)
    .filter((value): value is number => value !== null);
  return {
    status:
      verified.length >= 2
        ? "views-registered"
        : "insufficient-verified-views",
    solver: "opencv-orb-homography",
    solverVersion: "opencv-js-5.0.0",
    canonicalImageSha256: hash(canonicalImage),
    requestedAlternateViewCount: uniqueAlternates.length,
    verifiedAlternateViewCount: verified.length,
    cameraPoseVerified: false,
    aggregateReprojectionRmsPixels:
      residuals.length > 0
        ? Math.round(
            (residuals.reduce((sum, value) => sum + value, 0) /
              residuals.length) *
              1000,
          ) / 1000
        : null,
    registrations,
    notes: [
      `${verified.length}/${uniqueAlternates.length} alternate views passed server-side image registration.`,
      "Homography registration verifies same-scene overlap but does not recover metric camera pose or absolute scale.",
      "The 99% gate remains locked until a camera solver produces intrinsics, extrinsics and independently recomputed residuals.",
    ],
  };
}
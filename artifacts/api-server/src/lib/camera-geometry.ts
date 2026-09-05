export type GeometryImage = {
  imageData: string;
  imageHash: string;
};

export type CameraIntrinsics = {
  imageHash: string;
  width: number;
  height: number;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  distortion: number[];
};

export type CameraExtrinsics = {
  imageHash: string;
  rotation: number[][];
  translation: number[];
  cameraCenter: number[];
};

export type PointTrackObservation = {
  imageHash: string;
  x: number;
  y: number;
  residualPixels?: number;
};

export type PointTrack = {
  id: string;
  xyz: number[];
  observations: PointTrackObservation[];
};

export type ResidualDistribution = {
  totalCount: number;
  inlierCount: number;
  outlierCount: number;
  inlierThresholdPixels: number;
  meanPixels: number;
  medianPixels: number;
  rmsPixels: number;
  p95Pixels: number;
  maxPixels: number;
};

export type GeometryProposalArtifact = {
  provider: "depth-anything-3" | "vggt" | "none";
  model: string;
  version: string;
  status: "ready" | "unavailable" | "failed";
  cameraIntrinsics: CameraIntrinsics[];
  cameraExtrinsics: CameraExtrinsics[];
  pointTracks: PointTrack[];
  error?: string;
};

export type CameraGeometryVerification = {
  status: "verified" | "rejected" | "unavailable" | "failed";
  imageHashes: string[];
  proposal: GeometryProposalArtifact;
  solver: "colmap" | "pycolmap" | "none";
  solverVersion: string;
  cameraIntrinsics: CameraIntrinsics[];
  cameraExtrinsics: CameraExtrinsics[];
  pointTracks: PointTrack[];
  inlierCount: number;
  residualDistribution: ResidualDistribution | null;
  serverComputedResiduals: boolean;
  error?: string;
};

type JsonObject = Record<string, unknown>;

const PROPOSAL_TIMEOUT_MS = 30_000;
const VERIFIER_TIMEOUT_MS = 60_000;
const INLIER_THRESHOLD_PIXELS = 1;
const MIN_VERIFIED_IMAGES = 3;
const MIN_VERIFIED_TRACKS = 12;
const MIN_INLIER_COUNT = 24;
const MIN_INLIER_RATIO = 0.8;
const MIN_CAMERA_BASELINE_RATIO = 0.005;
const MIN_MEDIAN_TRIANGULATION_ANGLE_DEGREES = 1;
const MATRIX_TOLERANCE = 1e-3;
const CENTER_TOLERANCE = 1e-3;

function distance(left: number[], right: number[]) {
  return Math.hypot(
    (left[0] ?? 0) - (right[0] ?? 0),
    (left[1] ?? 0) - (right[1] ?? 0),
    (left[2] ?? 0) - (right[2] ?? 0),
  );
}

function sceneDiameter(pointTracks: PointTrack[]) {
  if (pointTracks.length < 2) return 0;
  const axes = [0, 1, 2].map((axis) => {
    const values = pointTracks.map((track) => track.xyz[axis] ?? 0);
    return Math.max(...values) - Math.min(...values);
  });
  return Math.hypot(...axes);
}

function hasNonDegenerateCameraGeometry(
  geometry: CameraGeometryVerification,
) {
  const centers = geometry.cameraExtrinsics.map((camera) => camera.cameraCenter);
  if (centers.length < MIN_VERIFIED_IMAGES) return false;
  const diameter = sceneDiameter(geometry.pointTracks);
  if (!Number.isFinite(diameter) || diameter <= Number.EPSILON) return false;
  const baselineRatios: number[] = [];
  for (let left = 0; left < centers.length; left += 1) {
    for (let right = left + 1; right < centers.length; right += 1) {
      baselineRatios.push(
        distance(centers[left] ?? [], centers[right] ?? []) / diameter,
      );
    }
  }
  if (
    baselineRatios.length < 3 ||
    Math.min(...baselineRatios) < MIN_CAMERA_BASELINE_RATIO
  ) {
    return false;
  }
  const centerByImage = new Map(
    geometry.cameraExtrinsics.map((camera) => [
      camera.imageHash,
      camera.cameraCenter,
    ]),
  );
  const trackAngles = geometry.pointTracks.flatMap((track) => {
    const observedCenters = track.observations
      .map((observation) => centerByImage.get(observation.imageHash))
      .filter((center): center is number[] => Boolean(center));
    let maximumAngle = 0;
    for (let left = 0; left < observedCenters.length; left += 1) {
      for (let right = left + 1; right < observedCenters.length; right += 1) {
        const leftVector = track.xyz.map(
          (coordinate, axis) => coordinate - (observedCenters[left]?.[axis] ?? 0),
        );
        const rightVector = track.xyz.map(
          (coordinate, axis) => coordinate - (observedCenters[right]?.[axis] ?? 0),
        );
        const denominator =
          Math.hypot(...leftVector) * Math.hypot(...rightVector);
        if (denominator <= Number.EPSILON) continue;
        const cosine = Math.max(
          -1,
          Math.min(
            1,
            leftVector.reduce(
              (sum, value, axis) => sum + value * (rightVector[axis] ?? 0),
              0,
            ) / denominator,
          ),
        );
        maximumAngle = Math.max(
          maximumAngle,
          (Math.acos(cosine) * 180) / Math.PI,
        );
      }
    }
    return maximumAngle > 0 ? [maximumAngle] : [];
  }).sort((left, right) => left - right);
  const medianAngle =
    trackAngles.length > 0
      ? trackAngles[Math.floor(trackAngles.length / 2)] ?? 0
      : 0;
  return medianAngle >= MIN_MEDIAN_TRIANGULATION_ANGLE_DEGREES;
}

const isObject = (value: unknown): value is JsonObject =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const finiteNumber = (value: unknown): number | null => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
};

const finiteVector = (value: unknown, length: number): number[] | null => {
  if (!Array.isArray(value) || value.length !== length) return null;
  const numbers = value.map(finiteNumber);
  return numbers.every((number) => number !== null)
    ? (numbers as number[])
    : null;
};

const finiteMatrix = (value: unknown, size: number): number[][] | null => {
  if (!Array.isArray(value) || value.length !== size) return null;
  const rows = value.map((row) => finiteVector(row, size));
  return rows.every((row) => row !== null) ? (rows as number[][]) : null;
};

const payloadString = (payload: JsonObject, key: string, fallback: string) =>
  typeof payload[key] === "string" && payload[key]
    ? payload[key]
    : fallback;

function uniqueImages(images: GeometryImage[]) {
  return images.filter(
    (image, index) =>
      images.findIndex((candidate) => candidate.imageHash === image.imageHash) ===
      index,
  );
}

function emptyResult(
  images: GeometryImage[],
  overrides: Partial<CameraGeometryVerification> = {},
): CameraGeometryVerification {
  return {
    status: "unavailable",
    imageHashes: uniqueImages(images).map((image) => image.imageHash),
    proposal: {
      provider: "none",
      model: "none",
      version: "none",
      status: "unavailable",
      cameraIntrinsics: [],
      cameraExtrinsics: [],
      pointTracks: [],
    },
    solver: "none",
    solverVersion: "none",
    cameraIntrinsics: [],
    cameraExtrinsics: [],
    pointTracks: [],
    inlierCount: 0,
    residualDistribution: null,
    serverComputedResiduals: false,
    ...overrides,
  };
}

async function requestJson(
  endpoint: string,
  body: unknown,
  timeoutMs: number,
  label: string,
): Promise<JsonObject> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${label} returned HTTP ${response.status}`);
    }
    const value: unknown = await response.json();
    if (!isObject(value)) throw new Error(`${label} returned a non-object response`);
    return value;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseIntrinsics(value: unknown, imageHashes: Set<string>) {
  if (!Array.isArray(value)) return null;
  const cameras: CameraIntrinsics[] = [];
  for (const item of value) {
    if (!isObject(item)) return null;
    const imageHash =
      typeof item.imageHash === "string" ? item.imageHash : undefined;
    const source = isObject(item.intrinsics) ? item.intrinsics : item;
    if (!imageHash || !imageHashes.has(imageHash) || !isObject(source)) return null;
    const width = finiteNumber(source.width);
    const height = finiteNumber(source.height);
    const fx = finiteNumber(source.fx ?? source.focalLengthX);
    const fy = finiteNumber(source.fy ?? source.focalLengthY ?? fx);
    const cx = finiteNumber(source.cx ?? source.principalPointX);
    const cy = finiteNumber(source.cy ?? source.principalPointY);
    const distortion = Array.isArray(source.distortion)
      ? source.distortion.map(finiteNumber)
      : [];
    if (
      width === null ||
      height === null ||
      fx === null ||
      fy === null ||
      cx === null ||
      cy === null ||
      width < 2 ||
      height < 2 ||
      fx <= 0 ||
      fy <= 0 ||
      distortion.some((coefficient) => coefficient === null)
    ) {
      return null;
    }
    cameras.push({
      imageHash,
      width,
      height,
      fx,
      fy,
      cx,
      cy,
      distortion: distortion as number[],
    });
  }
  return cameras.length ? cameras : null;
}

function parseExtrinsics(value: unknown, imageHashes: Set<string>) {
  if (!Array.isArray(value)) return null;
  const cameras: CameraExtrinsics[] = [];
  for (const item of value) {
    if (!isObject(item)) return null;
    const imageHash =
      typeof item.imageHash === "string" ? item.imageHash : undefined;
    const source = isObject(item.extrinsics) ? item.extrinsics : item;
    if (!imageHash || !imageHashes.has(imageHash) || !isObject(source)) return null;
    const rotation = finiteMatrix(source.rotation ?? source.R, 3);
    const translation = finiteVector(source.translation ?? source.t, 3);
    const cameraCenter = finiteVector(
      source.cameraCenter ?? source.center ?? source.C,
      3,
    );
    if (!rotation || !translation || !cameraCenter) return null;
    cameras.push({ imageHash, rotation, translation, cameraCenter });
  }
  return cameras.length ? cameras : null;
}

function parsePointTracks(value: unknown, imageHashes: Set<string>) {
  if (!Array.isArray(value)) return null;
  const tracks: PointTrack[] = [];
  for (const item of value) {
    if (!isObject(item)) return null;
    const id = typeof item.id === "string" ? item.id : undefined;
    const xyz = finiteVector(item.xyz ?? item.point3d ?? item.position, 3);
    const observationsValue = item.observations ?? item.track;
    if (!id || !xyz || !Array.isArray(observationsValue)) return null;
    const observations: PointTrackObservation[] = [];
    for (const observation of observationsValue) {
      if (!isObject(observation)) return null;
      const imageHash =
        typeof observation.imageHash === "string"
          ? observation.imageHash
          : undefined;
      const x = finiteNumber(observation.x);
      const y = finiteNumber(observation.y);
      if (!imageHash || !imageHashes.has(imageHash) || x === null || y === null) {
        return null;
      }
      observations.push({ imageHash, x, y });
    }
    if (observations.length >= 2) tracks.push({ id, xyz, observations });
  }
  return tracks.length ? tracks : null;
}

function parseGeometryPayload(
  payload: JsonObject,
  images: GeometryImage[],
) {
  const imageHashes = new Set(uniqueImages(images).map((image) => image.imageHash));
  const cameraIntrinsics = parseIntrinsics(
    payload.cameraIntrinsics ?? (Array.isArray(payload.cameras) ? payload.cameras : null),
    imageHashes,
  );
  const cameraExtrinsics = parseExtrinsics(
    payload.cameraExtrinsics ?? (Array.isArray(payload.cameras) ? payload.cameras : null),
    imageHashes,
  );
  const pointTracks = parsePointTracks(
    payload.pointTracks ?? payload.tracks,
    imageHashes,
  );
  if (!cameraIntrinsics || !cameraExtrinsics || !pointTracks) {
    throw new Error(
      "Geometry adapter must return cameraIntrinsics, cameraExtrinsics, and pointTracks",
    );
  }
  return { cameraIntrinsics, cameraExtrinsics, pointTracks };
}

function dot(left: number[], right: number[]) {
  return left.reduce(
    (sum, value, index) => sum + value * (right[index] ?? 0),
    0,
  );
}

function determinant3(matrix: number[][]) {
  return (
    matrix[0][0] *
      (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) -
    matrix[0][1] *
      (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0]) +
    matrix[0][2] *
      (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0])
  );
}

function assertUniqueCompleteHashes(
  values: Array<{ imageHash: string }>,
  expectedHashes: string[],
  label: string,
) {
  const hashes = values.map((value) => value.imageHash);
  if (
    hashes.length !== expectedHashes.length ||
    new Set(hashes).size !== hashes.length ||
    expectedHashes.some((hash) => !hashes.includes(hash))
  ) {
    throw new Error(
      `${label} must contain exactly one record for every unique input image`,
    );
  }
}

function assertGeometryIntegrity(
  geometry: ReturnType<typeof parseGeometryPayload>,
  imageHashes: string[],
) {
  assertUniqueCompleteHashes(
    geometry.cameraIntrinsics,
    imageHashes,
    "Camera intrinsics",
  );
  assertUniqueCompleteHashes(
    geometry.cameraExtrinsics,
    imageHashes,
    "Camera extrinsics",
  );

  const intrinsicsByImage = new Map(
    geometry.cameraIntrinsics.map((camera) => [camera.imageHash, camera]),
  );
  for (const intrinsics of geometry.cameraIntrinsics) {
    if (
      intrinsics.cx < 0 ||
      intrinsics.cx >= intrinsics.width ||
      intrinsics.cy < 0 ||
      intrinsics.cy >= intrinsics.height
    ) {
      throw new Error("Camera principal point must be inside the image");
    }
    if (
      intrinsics.distortion.some(
        (coefficient) => Math.abs(coefficient) > Number.EPSILON,
      )
    ) {
      throw new Error(
        "Only undistorted PINHOLE cameras are eligible for server residual verification",
      );
    }
  }

  for (const extrinsics of geometry.cameraExtrinsics) {
    const rows = extrinsics.rotation;
    const isOrthonormal = rows.every(
      (row, rowIndex) =>
        Math.abs(dot(row, row) - 1) <= MATRIX_TOLERANCE &&
        rows.every(
          (other, otherIndex) =>
            rowIndex === otherIndex ||
            Math.abs(dot(row, other)) <= MATRIX_TOLERANCE,
        ),
    );
    if (
      !isOrthonormal ||
      Math.abs(determinant3(rows) - 1) > MATRIX_TOLERANCE
    ) {
      throw new Error("Camera rotation must be an orthonormal SO(3) matrix");
    }
    const expectedCenter = [0, 1, 2].map(
      (column) =>
        -rows.reduce(
          (sum, row, rowIndex) =>
            sum + row[column] * extrinsics.translation[rowIndex],
          0,
        ),
    );
    if (
      expectedCenter.some(
        (value, index) =>
          Math.abs(value - extrinsics.cameraCenter[index]) > CENTER_TOLERANCE,
      )
    ) {
      throw new Error("Camera center is inconsistent with rotation and translation");
    }
  }

  const trackIds = geometry.pointTracks.map((track) => track.id);
  if (new Set(trackIds).size !== trackIds.length) {
    throw new Error("Point track ids must be unique");
  }
  for (const track of geometry.pointTracks) {
    const observationHashes = track.observations.map(
      (observation) => observation.imageHash,
    );
    if (new Set(observationHashes).size !== observationHashes.length) {
      throw new Error("A point track may contain only one observation per image");
    }
    for (const observation of track.observations) {
      const intrinsics = intrinsicsByImage.get(observation.imageHash);
      if (
        !intrinsics ||
        observation.x < 0 ||
        observation.x >= intrinsics.width ||
        observation.y < 0 ||
        observation.y >= intrinsics.height
      ) {
        throw new Error("Point track observation must be inside its source image");
      }
    }
  }
}

function buildProposalArtifact(
  provider: GeometryProposalArtifact["provider"],
  model: string,
  version: string,
  status: GeometryProposalArtifact["status"],
  geometry?: ReturnType<typeof parseGeometryPayload>,
  error?: string,
): GeometryProposalArtifact {
  return {
    provider,
    model,
    version,
    status,
    cameraIntrinsics: geometry?.cameraIntrinsics ?? [],
    cameraExtrinsics: geometry?.cameraExtrinsics ?? [],
    pointTracks: geometry?.pointTracks ?? [],
    ...(error ? { error } : {}),
  };
}

function percentile(sorted: number[], fraction: number) {
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
}

function project(
  point: number[],
  intrinsics: CameraIntrinsics,
  extrinsics: CameraExtrinsics,
) {
  const [x, y, z] = point;
  const cameraX =
    extrinsics.rotation[0][0] * x +
    extrinsics.rotation[0][1] * y +
    extrinsics.rotation[0][2] * z +
    extrinsics.translation[0];
  const cameraY =
    extrinsics.rotation[1][0] * x +
    extrinsics.rotation[1][1] * y +
    extrinsics.rotation[1][2] * z +
    extrinsics.translation[1];
  const cameraZ =
    extrinsics.rotation[2][0] * x +
    extrinsics.rotation[2][1] * y +
    extrinsics.rotation[2][2] * z +
    extrinsics.translation[2];
  if (cameraZ <= Number.EPSILON) return null;
  return {
    x: intrinsics.fx * (cameraX / cameraZ) + intrinsics.cx,
    y: intrinsics.fy * (cameraY / cameraZ) + intrinsics.cy,
  };
}

function computeServerResiduals(
  cameraIntrinsics: CameraIntrinsics[],
  cameraExtrinsics: CameraExtrinsics[],
  pointTracks: PointTrack[],
) {
  const intrinsicsByImage = new Map(
    cameraIntrinsics.map((camera) => [camera.imageHash, camera]),
  );
  const extrinsicsByImage = new Map(
    cameraExtrinsics.map((camera) => [camera.imageHash, camera]),
  );
  const residuals: number[] = [];
  const tracks = pointTracks.map((track) => ({
    ...track,
    observations: track.observations.map((observation) => {
      const intrinsics = intrinsicsByImage.get(observation.imageHash);
      const extrinsics = extrinsicsByImage.get(observation.imageHash);
      const projected =
        intrinsics && extrinsics
          ? project(track.xyz, intrinsics, extrinsics)
          : null;
      const residualPixels = projected
        ? Math.hypot(projected.x - observation.x, projected.y - observation.y)
        : null;
      if (residualPixels !== null && Number.isFinite(residualPixels)) {
        residuals.push(residualPixels);
        return { ...observation, residualPixels };
      }
      return observation;
    }),
  }));
  if (!residuals.length) {
    throw new Error("No finite server-computed camera residuals were available");
  }
  const sorted = [...residuals].sort((left, right) => left - right);
  const sum = residuals.reduce((total, residual) => total + residual, 0);
  const rms = Math.sqrt(
    residuals.reduce((total, residual) => total + residual ** 2, 0) /
      residuals.length,
  );
  const distribution: ResidualDistribution = {
    totalCount: residuals.length,
    inlierCount: residuals.filter(
      (residual) => residual <= INLIER_THRESHOLD_PIXELS,
    ).length,
    outlierCount: residuals.filter(
      (residual) => residual > INLIER_THRESHOLD_PIXELS,
    ).length,
    inlierThresholdPixels: INLIER_THRESHOLD_PIXELS,
    meanPixels: sum / residuals.length,
    medianPixels: percentile(sorted, 0.5),
    rmsPixels: rms,
    p95Pixels: percentile(sorted, 0.95),
    maxPixels: sorted[sorted.length - 1],
  };
  return { tracks, distribution };
}

function verifiedImageCount(geometry: CameraGeometryVerification) {
  const intrinsics = new Set(
    geometry.cameraIntrinsics.map((camera) => camera.imageHash),
  );
  const extrinsics = new Set(
    geometry.cameraExtrinsics.map((camera) => camera.imageHash),
  );
  const observed = new Set(
    geometry.pointTracks.flatMap((track) =>
      track.observations
        .filter((observation) => observation.residualPixels !== undefined)
        .map((observation) => observation.imageHash),
    ),
  );
  return geometry.imageHashes.filter(
    (imageHash) =>
      intrinsics.has(imageHash) &&
      extrinsics.has(imageHash) &&
      observed.has(imageHash),
  ).length;
}

function hasSufficientInlierSupport(geometry: CameraGeometryVerification) {
  const distribution = geometry.residualDistribution;
  if (!distribution || distribution.totalCount === 0) return false;
  const adjacency = new Map(
    geometry.imageHashes.map((imageHash) => [imageHash, new Set<string>()]),
  );
  let verifiedTrackCount = 0;
  for (const track of geometry.pointTracks) {
    const inlierHashes = track.observations
      .filter(
        (observation) =>
          observation.residualPixels !== undefined &&
          observation.residualPixels <= INLIER_THRESHOLD_PIXELS,
      )
      .map((observation) => observation.imageHash);
    if (inlierHashes.length < 2) continue;
    verifiedTrackCount += 1;
    for (const from of inlierHashes) {
      for (const to of inlierHashes) {
        if (from !== to) adjacency.get(from)?.add(to);
      }
    }
  }
  const first = geometry.imageHashes[0];
  const visited = new Set<string>();
  const queue = first ? [first] : [];
  while (queue.length) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!visited.has(neighbor)) queue.push(neighbor);
    }
  }
  return (
    verifiedTrackCount >= MIN_VERIFIED_TRACKS &&
    distribution.inlierCount >= MIN_INLIER_COUNT &&
    distribution.inlierCount / distribution.totalCount >= MIN_INLIER_RATIO &&
    geometry.imageHashes.every((imageHash) => visited.has(imageHash))
  );
}

export async function runCameraGeometryVerification(
  images: GeometryImage[],
): Promise<CameraGeometryVerification> {
  const unique = uniqueImages(images);
  const imageHashes = unique.map((image) => image.imageHash);
  const proposalEndpoint = process.env.WORLD_FORGE_GEOMETRY_PROPOSAL_ENDPOINT;
  const providerValue = process.env.WORLD_FORGE_GEOMETRY_PROPOSAL_PROVIDER;
  const provider =
    providerValue === "vggt" ? "vggt" : ("depth-anything-3" as const);
  const proposalModel =
    process.env.WORLD_FORGE_GEOMETRY_PROPOSAL_MODEL ?? provider;
  const proposalVersion =
    process.env.WORLD_FORGE_GEOMETRY_PROPOSAL_VERSION ?? "configured-endpoint";

  if (unique.length < 2) {
    return emptyResult(unique, {
      proposal: buildProposalArtifact(
        provider,
        proposalModel,
        proposalVersion,
        "unavailable",
        undefined,
        "At least two unique same-scene images are required for a camera proposal.",
      ),
    });
  }

  if (!proposalEndpoint) {
    return emptyResult(unique, {
      proposal: buildProposalArtifact(
        provider,
        proposalModel,
        proposalVersion,
        "unavailable",
        undefined,
        "No Depth Anything 3/VGGT proposal endpoint is configured; geometry remains a hypothesis.",
      ),
    });
  }

  let proposalPayload: JsonObject;
  try {
    proposalPayload = await requestJson(
      proposalEndpoint,
      {
        images: unique,
        imageHashes,
        provider,
      },
      PROPOSAL_TIMEOUT_MS,
      "Geometry proposal endpoint",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Proposal failed";
    return emptyResult(unique, {
      status: "failed",
      proposal: buildProposalArtifact(
        provider,
        proposalModel,
        proposalVersion,
        "failed",
        undefined,
        message,
      ),
      error: message,
    });
  }

  let proposalGeometry: ReturnType<typeof parseGeometryPayload>;
  try {
    proposalGeometry = parseGeometryPayload(proposalPayload, unique);
    assertGeometryIntegrity(proposalGeometry, imageHashes);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid proposal";
    return emptyResult(unique, {
      status: "failed",
      proposal: buildProposalArtifact(
        provider,
        payloadString(proposalPayload, "model", proposalModel),
        payloadString(proposalPayload, "version", proposalVersion),
        "failed",
        undefined,
        message,
      ),
      error: message,
    });
  }
  const proposal = buildProposalArtifact(
    provider,
    payloadString(proposalPayload, "model", proposalModel),
    payloadString(proposalPayload, "version", proposalVersion),
    "ready",
    proposalGeometry,
  );

  const solverEndpoint = process.env.WORLD_FORGE_COLMAP_ENDPOINT;
  if (!solverEndpoint) {
    return emptyResult(unique, {
      proposal,
      error:
        "No COLMAP/pycolmap verification endpoint is configured; proposal geometry is not evidence.",
    });
  }

  let solverPayload: JsonObject;
  try {
    solverPayload = await requestJson(
      solverEndpoint,
      {
        images: unique,
        imageHashes,
        proposal: proposalPayload,
      },
      VERIFIER_TIMEOUT_MS,
      "COLMAP/pycolmap verification endpoint",
    );
  } catch (error) {
    return emptyResult(unique, {
      proposal,
      status: "failed",
      error: error instanceof Error ? error.message : "Geometric verification failed",
    });
  }

  const solverValue = solverPayload.solver;
  const solver =
    solverValue === "pycolmap" ? "pycolmap" : solverValue === "colmap" ? "colmap" : "none";
  const solverVersion = payloadString(solverPayload, "solverVersion", "unknown");
  if (solver === "none" || solverVersion === "unknown") {
    return emptyResult(unique, {
      proposal,
      status: "failed",
      solver,
      solverVersion,
      error: "Verification response must identify a COLMAP or pycolmap solver version",
    });
  }

  let verifiedGeometry: ReturnType<typeof parseGeometryPayload>;
  try {
    verifiedGeometry = parseGeometryPayload(solverPayload, unique);
    assertGeometryIntegrity(verifiedGeometry, imageHashes);
  } catch (error) {
    return emptyResult(unique, {
      proposal,
      status: "failed",
      solver,
      solverVersion,
      error: error instanceof Error ? error.message : "Invalid solver response",
    });
  }

  try {
    const computed = computeServerResiduals(
      verifiedGeometry.cameraIntrinsics,
      verifiedGeometry.cameraExtrinsics,
      verifiedGeometry.pointTracks,
    );
    const candidate: CameraGeometryVerification = {
      status: "rejected",
      imageHashes,
      proposal,
      solver,
      solverVersion,
      cameraIntrinsics: verifiedGeometry.cameraIntrinsics,
      cameraExtrinsics: verifiedGeometry.cameraExtrinsics,
      pointTracks: computed.tracks,
      inlierCount: computed.distribution.inlierCount,
      residualDistribution: computed.distribution,
      serverComputedResiduals: true,
    };
    const status =
      verifiedImageCount(candidate) >= MIN_VERIFIED_IMAGES &&
      hasSufficientInlierSupport(candidate) &&
      hasNonDegenerateCameraGeometry(candidate) &&
      computed.distribution.meanPixels <= INLIER_THRESHOLD_PIXELS
        ? "verified"
        : "rejected";
    return {
      ...candidate,
      status,
      ...(status === "rejected"
        ? {
            error:
              "Server-computed geometry did not satisfy the three-view, camera-baseline, triangulation-angle and 1px residual gate.",
          }
        : {}),
    };
  } catch (error) {
    return emptyResult(unique, {
      proposal,
      status: "failed",
      solver,
      solverVersion,
      error:
        error instanceof Error ? error.message : "Residual computation failed",
    });
  }
}

export function isVerifiedCameraGeometry(
  geometry: CameraGeometryVerification | undefined,
  imageCount: number,
) {
  return Boolean(
    geometry?.status === "verified" &&
      geometry.serverComputedResiduals &&
      imageCount >= MIN_VERIFIED_IMAGES &&
      verifiedImageCount(geometry) >= MIN_VERIFIED_IMAGES &&
      hasSufficientInlierSupport(geometry) &&
      hasNonDegenerateCameraGeometry(geometry) &&
      geometry.residualDistribution &&
      geometry.residualDistribution.meanPixels <= INLIER_THRESHOLD_PIXELS &&
      geometry.residualDistribution.inlierCount > 0 &&
      geometry.inlierCount === geometry.residualDistribution.inlierCount,
  );
}
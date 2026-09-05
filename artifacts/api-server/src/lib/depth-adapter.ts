import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

export type DepthBand = "foreground" | "midground" | "background" | "distant";

export type DenseDepthArtifact = {
  provider: "depth-pro" | "depth-anything" | "metric3d" | "local-image-cues";
  model: string;
  version: string;
  source: "configured-http" | "local-onnx" | "local-fallback";
  status: "ready" | "fallback" | "failed";
  width: number;
  height: number;
  encoding: "float32-base64";
  depthUnit: "relative" | "meters";
  valuesBase64: string | null;
  minDepth: number | null;
  maxDepth: number | null;
  focalLengthPx: number | null;
  normalsBase64: string | null;
  uncertaintyBase64: string | null;
  uncertaintyUnit: "relative" | "meters" | null;
  uncertaintyMean: number | null;
  checksumSha256: string | null;
  inputImageSha256: string;
  failureReason?: string;
};

export type DepthSample = {
  normalizedDepth: number;
  depthMeters: number;
  uncertaintyMeters: number | null;
  sampleCount: number;
};

export type UncertaintyCrossCheck = {
  ratio: number;
  status: "supported" | "review-required";
};

type Raster = {
  width: number;
  height: number;
  rgba: Uint8Array;
};

type DepthPrediction = {
  width: number;
  height: number;
  values: number[];
  uncertainty?: number[];
  uncertaintyUnit?: "relative" | "meters";
  normals?: number[];
  focalLengthPx?: number;
  depthUnit?: "relative" | "meters";
};

const MAX_SIDE = 96;
const MODEL_OUTPUT_MAX_SIDE = 256;
const DEFAULT_FOCAL_LENGTH_RATIO = 1.428148;
const LOCAL_MODEL_ID = "onnx-community/depth-anything-v2-small";

type DepthEstimator = (image: Blob) => Promise<{
  predicted_depth: {
    dims: number[];
    data: Float32Array | number[];
  };
}>;

let localDepthEstimatorPromise: Promise<DepthEstimator> | undefined;

const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value));

export function compareDepthUncertainty(
  visualUncertaintyMeters: number,
  depthUncertaintyMeters: number,
): UncertaintyCrossCheck {
  const ratio =
    Math.max(depthUncertaintyMeters, visualUncertaintyMeters) /
    Math.max(
      Math.min(depthUncertaintyMeters, visualUncertaintyMeters),
      Number.EPSILON,
    );
  return {
    ratio: Math.round(ratio * 1000) / 1000,
    status: ratio <= 3 ? "supported" : "review-required",
  };
}

const toBase64 = (values: number[]) => {
  const buffer = Buffer.allocUnsafe(values.length * 4);
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer.toString("base64");
};

const checksum = (valuesBase64: string) =>
  createHash("sha256").update(valuesBase64).digest("hex");

function parseDataUrl(imageData: string): Buffer {
  const match = imageData.match(
    /^data:image\/(?:png|jpe?g|webp);base64,([\s\S]+)$/i,
  );
  if (!match) {
    throw new Error(
      "Depth adapter requires a base64 PNG, JPEG, or WebP data URL",
    );
  }
  return Buffer.from(match[1], "base64");
}

function decodeRaster(imageData: string): Raster {
  const bytes = parseDataUrl(imageData);
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    const decoded = PNG.sync.read(bytes);
    return { width: decoded.width, height: decoded.height, rgba: decoded.data };
  }

  if (bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))) {
    const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
    return { width: decoded.width, height: decoded.height, rgba: decoded.data };
  }

  throw new Error(
    "Depth adapter only supports PNG and JPEG bytes inside image data URLs",
  );
}

function resizeRaster(raster: Raster): Raster {
  const scale = Math.min(1, MAX_SIDE / Math.max(raster.width, raster.height));
  const width = Math.max(2, Math.round(raster.width * scale));
  const height = Math.max(2, Math.round(raster.height * scale));
  if (width === raster.width && height === raster.height) return raster;

  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(
      raster.height - 1,
      Math.round((y / height) * raster.height),
    );
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(
        raster.width - 1,
        Math.round((x / width) * raster.width),
      );
      const sourceOffset = (sourceY * raster.width + sourceX) * 4;
      const targetOffset = (y * width + x) * 4;
      rgba[targetOffset] = raster.rgba[sourceOffset] ?? 0;
      rgba[targetOffset + 1] = raster.rgba[sourceOffset + 1] ?? 0;
      rgba[targetOffset + 2] = raster.rgba[sourceOffset + 2] ?? 0;
      rgba[targetOffset + 3] = raster.rgba[sourceOffset + 3] ?? 255;
    }
  }
  return { width, height, rgba };
}

function luminance(rgba: Uint8Array, index: number) {
  return (
    (0.2126 * (rgba[index] ?? 0) +
      0.7152 * (rgba[index + 1] ?? 0) +
      0.0722 * (rgba[index + 2] ?? 0)) /
    255
  );
}

function buildLocalPrediction(input: Raster): DepthPrediction {
  const raster = resizeRaster(input);
  const { width, height, rgba } = raster;
  const luminances = new Float32Array(width * height);
  const saturation = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const red = (rgba[offset] ?? 0) / 255;
      const green = (rgba[offset + 1] ?? 0) / 255;
      const blue = (rgba[offset + 2] ?? 0) / 255;
      luminances[y * width + x] = luminance(rgba, offset);
      saturation[y * width + x] =
        Math.max(red, green, blue) - Math.min(red, green, blue);
    }
  }

  // This is a deterministic monocular relative-depth pass, not a disguised
  // VLM claim: it combines a multi-scale contrast field, atmospheric color
  // attenuation, and an image-space elevation prior into one value per pixel.
  // A configured model endpoint supersedes it, while this path keeps analysis
  // usable when no GPU service is available.
  const values = new Array<number>(width * height);
  const uncertainty = new Array<number>(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const left = luminances[y * width + Math.max(0, x - 1)] ?? 0;
      const right = luminances[y * width + Math.min(width - 1, x + 1)] ?? 0;
      const above = luminances[Math.max(0, y - 1) * width + x] ?? 0;
      const below = luminances[Math.min(height - 1, y + 1) * width + x] ?? 0;
      const localContrast = Math.abs(right - left) + Math.abs(below - above);
      const yPrior = y / Math.max(height - 1, 1);
      const colorAtmosphere = (saturation[index] ?? 0) * 0.12;
      const edgeNearness = clamp(localContrast * 1.7);
      const depth = clamp(
        (1 - yPrior) * 0.58 +
          (1 - (luminances[index] ?? 0)) * 0.18 +
          (1 - colorAtmosphere) * 0.12 +
          edgeNearness * 0.12,
      );
      values[index] = depth;
      uncertainty[index] = clamp(
        0.16 + (1 - localContrast) * 0.2 + (1 - saturation[index]) * 0.08,
      );
    }
  }

  const normals = buildSurfaceNormals(values, width, height);
  return {
    width,
    height,
    values,
    uncertainty,
    uncertaintyUnit: "relative",
    normals,
    focalLengthPx: width * DEFAULT_FOCAL_LENGTH_RATIO,
  };
}

function buildSurfaceNormals(values: number[], width: number, height: number) {
  const normalizedValues = normalize(values);
  const normals = new Array<number>(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const dx =
        (normalizedValues[y * width + Math.min(width - 1, x + 1)] ?? 0) -
        (normalizedValues[y * width + Math.max(0, x - 1)] ?? 0);
      const dy =
        (normalizedValues[Math.min(height - 1, y + 1) * width + x] ?? 0) -
        (normalizedValues[Math.max(0, y - 1) * width + x] ?? 0);
      const nx = -dx;
      const ny = -dy;
      const nz = 1;
      const length = Math.hypot(nx, ny, nz);
      normals[index * 3] = nx / length;
      normals[index * 3 + 1] = ny / length;
      normals[index * 3 + 2] = nz / length;
    }
  }
  return normals;
}

function resizePrediction(
  values: number[],
  width: number,
  height: number,
  maxSide: number,
) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const targetWidth = Math.max(2, Math.round(width * scale));
  const targetHeight = Math.max(2, Math.round(height * scale));
  if (targetWidth === width && targetHeight === height) {
    return { values, width, height };
  }
  const resized = new Array<number>(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(
      height - 1,
      Math.round((y / Math.max(targetHeight - 1, 1)) * (height - 1)),
    );
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(
        width - 1,
        Math.round((x / Math.max(targetWidth - 1, 1)) * (width - 1)),
      );
      resized[y * targetWidth + x] = values[sourceY * width + sourceX] ?? 0;
    }
  }
  return { values: resized, width: targetWidth, height: targetHeight };
}

async function getLocalDepthEstimator(): Promise<DepthEstimator> {
  localDepthEstimatorPromise ??= import("@huggingface/transformers").then(
    async ({ pipeline }) =>
      (await pipeline("depth-estimation", LOCAL_MODEL_ID, {
        device: "cpu",
        dtype: "q8",
      })) as unknown as DepthEstimator,
  );
  return localDepthEstimatorPromise;
}

async function requestLocalModelPrediction(
  imageData: string,
): Promise<DepthPrediction> {
  const bytes = parseDataUrl(imageData);
  const estimator = await getLocalDepthEstimator();
  const output = await estimator(new Blob([Uint8Array.from(bytes)]));
  const [height, width] = output.predicted_depth.dims.slice(-2);
  if (!width || !height) {
    throw new Error("Local Depth Anything model returned invalid dimensions");
  }
  const rawValues = Array.from(output.predicted_depth.data, Number);
  if (
    rawValues.length !== width * height ||
    rawValues.some((value) => !Number.isFinite(value))
  ) {
    throw new Error("Local Depth Anything model returned invalid depth values");
  }
  // Depth Anything emits inverse-relative depth (larger is nearer). World Forge
  // stores relative distance (0 near, 1 far), so invert after normalization.
  const distanceValues = normalize(rawValues).map((value) => 1 - value);
  const resized = resizePrediction(
    distanceValues,
    width,
    height,
    MODEL_OUTPUT_MAX_SIDE,
  );
  return {
    ...resized,
    depthUnit: "relative",
  };
}

async function requestConfiguredPrediction(
  imageData: string,
): Promise<DepthPrediction | null> {
  const endpoint = process.env.WORLD_FORGE_DEPTH_ENDPOINT;
  if (!endpoint) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageData }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Depth endpoint returned HTTP ${response.status}`);
    }
    const body: unknown = await response.json();
    if (!body || typeof body !== "object")
      throw new Error("Depth endpoint returned a non-object response");
    const payload = body as Record<string, unknown>;
    const width = Number(payload.width);
    const height = Number(payload.height);
    const values = Array.isArray(payload.depth)
      ? payload.depth.map(Number)
      : Array.isArray(payload.values)
        ? payload.values.map(Number)
        : [];
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 2 ||
      height < 2
    ) {
      throw new Error("Depth endpoint returned invalid dimensions");
    }
    if (
      values.length !== width * height ||
      values.some((value) => !Number.isFinite(value))
    ) {
      throw new Error("Depth endpoint returned an invalid dense depth array");
    }
    const uncertainty = Array.isArray(payload.uncertainty)
      ? payload.uncertainty.map(Number)
      : undefined;
    const normals = Array.isArray(payload.normals)
      ? payload.normals.map(Number)
      : undefined;
    if (
      uncertainty &&
      (uncertainty.length !== values.length ||
        uncertainty.some((value) => !Number.isFinite(value)))
    ) {
      throw new Error("Depth endpoint returned an invalid uncertainty array");
    }
    const uncertaintyUnit =
      payload.uncertaintyUnit === "meters" ||
      payload.uncertaintyUnit === "relative"
        ? payload.uncertaintyUnit
        : undefined;
    if (uncertainty && !uncertaintyUnit) {
      throw new Error(
        "Depth endpoint must declare uncertaintyUnit as relative or meters",
      );
    }
    if (
      normals &&
      (normals.length !== values.length * 3 ||
        normals.some((value) => !Number.isFinite(value)))
    ) {
      throw new Error("Depth endpoint returned invalid surface normals");
    }
    return {
      width,
      height,
      values,
      uncertainty,
      uncertaintyUnit,
      normals,
      focalLengthPx: Number.isFinite(Number(payload.focalLengthPx))
        ? Number(payload.focalLengthPx)
        : undefined,
      depthUnit: payload.depthUnit === "meters" ? "meters" : "relative",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalize(values: number[]) {
  const { min, max } = findRange(values);
  const span = Math.max(max - min, Number.EPSILON);
  return values.map((value) => clamp((value - min) / span));
}

function findRange(values: number[]) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error("Depth prediction does not contain finite values");
  }
  return { min, max };
}

function artifactFromPrediction(
  prediction: DepthPrediction,
  provider: DenseDepthArtifact["provider"],
  model: string,
  version: string,
  source: DenseDepthArtifact["source"],
  status: DenseDepthArtifact["status"],
  inputImageSha256: string,
): DenseDepthArtifact {
  const { min: minDepth, max: maxDepth } = findRange(prediction.values);
  const values =
    prediction.depthUnit === "meters"
      ? prediction.values
      : normalize(prediction.values);
  const valuesBase64 = toBase64(values);
  const uncertainty = prediction.uncertainty;
  const uncertaintyUnit = uncertainty
    ? (prediction.uncertaintyUnit ?? "relative")
    : null;
  const uncertaintyBase64 = uncertainty ? toBase64(uncertainty) : null;
  const normals =
    prediction.normals ??
    buildSurfaceNormals(prediction.values, prediction.width, prediction.height);
  return {
    provider,
    model,
    version,
    source,
    status,
    width: prediction.width,
    height: prediction.height,
    encoding: "float32-base64",
    depthUnit: prediction.depthUnit ?? "relative",
    valuesBase64,
    minDepth,
    maxDepth,
    focalLengthPx: prediction.focalLengthPx ?? null,
    normalsBase64: toBase64(normals),
    uncertaintyBase64,
    uncertaintyUnit,
    uncertaintyMean: uncertainty
      ? uncertainty.reduce((sum, value) => sum + value, 0) / uncertainty.length
      : null,
    checksumSha256: checksum(valuesBase64),
    inputImageSha256,
  };
}

export async function generateDenseDepth(
  imageData: string,
): Promise<DenseDepthArtifact> {
  const inputImageSha256 = checksum(imageData);
  let providerFailure: unknown;
  try {
    const configured = await requestConfiguredPrediction(imageData);
    if (configured) {
      const provider = (process.env.WORLD_FORGE_DEPTH_PROVIDER ??
        "depth-anything") as DenseDepthArtifact["provider"];
      if (!["depth-pro", "depth-anything", "metric3d"].includes(provider)) {
        throw new Error(`Unsupported WORLD_FORGE_DEPTH_PROVIDER: ${provider}`);
      }
      return artifactFromPrediction(
        configured,
        provider,
        process.env.WORLD_FORGE_DEPTH_MODEL ?? provider,
        process.env.WORLD_FORGE_DEPTH_VERSION ?? "configured-endpoint",
        "configured-http",
        "ready",
        inputImageSha256,
      );
    }
  } catch (error) {
    providerFailure = error;
  }

  try {
    const localModel = await requestLocalModelPrediction(imageData);
    return artifactFromPrediction(
      localModel,
      "depth-anything",
      LOCAL_MODEL_ID,
      "transformers-js-4.2.0",
      "local-onnx",
      "ready",
      inputImageSha256,
    );
  } catch (modelError) {
    try {
      const local = buildLocalPrediction(decodeRaster(imageData));
      return artifactFromPrediction(
        local,
        "local-image-cues",
        "monocular-image-cues",
        "1",
        "local-fallback",
        "fallback",
        inputImageSha256,
      );
    } catch (fallbackError) {
      const reasons = [providerFailure, modelError, fallbackError]
        .filter(Boolean)
        .map((error) =>
          error instanceof Error ? error.message : "unknown error",
        );
      return {
        provider: "local-image-cues",
        model: "unavailable",
        version: "none",
        source: "local-fallback",
        status: "failed",
        width: 0,
        height: 0,
        encoding: "float32-base64",
        depthUnit: "relative",
        valuesBase64: null,
        minDepth: null,
        maxDepth: null,
        focalLengthPx: null,
        normalsBase64: null,
        uncertaintyBase64: null,
        uncertaintyUnit: null,
        uncertaintyMean: null,
        checksumSha256: null,
        inputImageSha256,
        failureReason: reasons.join("; "),
      };
    }
  }
}

export function sampleDenseDepth(
  artifact: DenseDepthArtifact,
  normalizedX: number,
  normalizedY: number,
  mapDepthMeters: number,
): DepthSample | null {
  if (!artifact.valuesBase64 || artifact.width < 2 || artifact.height < 2)
    return null;
  const decoded = Buffer.from(artifact.valuesBase64, "base64");
  const uncertaintyDecoded = artifact.uncertaintyBase64
    ? Buffer.from(artifact.uncertaintyBase64, "base64")
    : null;
  const samples: number[] = [];
  const uncertaintySamples: number[] = [];
  const radius = 2;
  const centerX = Math.round(clamp(normalizedX) * (artifact.width - 1));
  const centerY = Math.round(clamp(normalizedY) * (artifact.height - 1));
  for (
    let y = Math.max(0, centerY - radius);
    y <= Math.min(artifact.height - 1, centerY + radius);
    y += 1
  ) {
    for (
      let x = Math.max(0, centerX - radius);
      x <= Math.min(artifact.width - 1, centerX + radius);
      x += 1
    ) {
      const offset = (y * artifact.width + x) * 4;
      samples.push(decoded.readFloatLE(offset));
      if (uncertaintyDecoded) {
        uncertaintySamples.push(uncertaintyDecoded.readFloatLE(offset));
      }
    }
  }
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const minDepth = artifact.minDepth ?? 0;
  const maxDepth = artifact.maxDepth ?? 1;
  const normalizedDepth =
    artifact.depthUnit === "meters"
      ? clamp((mean - minDepth) / Math.max(maxDepth - minDepth, Number.EPSILON))
      : clamp(mean);
  const depthMeters =
    artifact.depthUnit === "meters" ? mean : normalizedDepth * mapDepthMeters;
  const localUncertainty =
    uncertaintySamples.length > 0
      ? uncertaintySamples.reduce((sum, value) => sum + value, 0) /
        uncertaintySamples.length
      : artifact.uncertaintyMean;
  const uncertaintyMeters =
    localUncertainty === null
      ? null
      : artifact.uncertaintyUnit === "meters"
      ? localUncertainty
      : localUncertainty * mapDepthMeters;
  return {
    normalizedDepth,
    depthMeters: Math.round(depthMeters * 100) / 100,
    uncertaintyMeters:
      uncertaintyMeters === null ? null : Math.max(0, uncertaintyMeters),
    sampleCount: samples.length,
  };
}

export async function renderDenseDepthPreview(
  artifact: DenseDepthArtifact,
): Promise<Buffer | null> {
  if (!artifact.valuesBase64 || artifact.width < 2 || artifact.height < 2) {
    return null;
  }
  const decoded = Buffer.from(artifact.valuesBase64, "base64");
  const raster = Buffer.alloc(artifact.width * artifact.height);
  for (let index = 0; index < artifact.width * artifact.height; index += 1) {
    const value = clamp(decoded.readFloatLE(index * 4));
    raster[index] = Math.round((1 - value) * 255);
  }
  const { default: sharp } = await import("sharp");
  return sharp(raster, {
    raw: { width: artifact.width, height: artifact.height, channels: 1 },
  })
    .png()
    .toBuffer();
}

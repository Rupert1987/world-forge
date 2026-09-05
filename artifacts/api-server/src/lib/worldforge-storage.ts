import { createHash, randomUUID } from "node:crypto";

const SIDECAR_URL = "http://127.0.0.1:1106";
const SIGNED_URL_TTL_SECONDS = 900;

type ObjectMethod = "GET" | "PUT" | "DELETE" | "HEAD";

function privateObjectDirectory() {
  const value = process.env.PRIVATE_OBJECT_DIR?.replace(/\/+$/, "");
  if (!value) throw new Error("World Forge object storage is not configured");
  return value.startsWith("/") ? value : `/${value}`;
}

function parseStoragePath(path: string) {
  const parts = path.replace(/^\/+/, "").split("/");
  const bucketName = parts.shift();
  if (!bucketName || parts.length === 0) throw new Error("Invalid object storage path");
  return { bucketName, objectName: parts.join("/") };
}

function ownerSegment(ownerId: string) {
  return createHash("sha256").update(ownerId).digest("hex").slice(0, 24);
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80) || "asset";
}

function projectPrefix(ownerId: string, projectId: string) {
  return `worldforge/${ownerSegment(ownerId)}/${safeSegment(projectId)}`;
}

async function signedUrl(fullPath: string, method: ObjectMethod, ttlSec = SIGNED_URL_TTL_SECONDS) {
  const { bucketName, objectName } = parseStoragePath(fullPath);
  const response = await fetch(`${SIDECAR_URL}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method,
      expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("Could not create a signed object storage URL");
  const body = await response.json() as { signed_url?: string };
  if (!body.signed_url) throw new Error("Object storage did not return a signed URL");
  return body.signed_url;
}

function objectPathToFullPath(objectPath: string) {
  if (!objectPath.startsWith("/objects/")) throw new Error("Invalid World Forge object path");
  return `${privateObjectDirectory()}/${objectPath.slice("/objects/".length)}`;
}

function fullPathToObjectPath(fullPath: string) {
  const directory = `${privateObjectDirectory()}/`;
  if (!fullPath.startsWith(directory)) throw new Error("Object is outside the private storage directory");
  return `/objects/${fullPath.slice(directory.length)}`;
}

export function assertProjectObjectPath(ownerId: string, projectId: string, objectPath: string) {
  const expected = `/objects/${projectPrefix(ownerId, projectId)}/`;
  if (!objectPath.startsWith(expected)) throw new Error("Uploaded object does not belong to this project");
}

export async function createProjectUploadUrl(input: {
  ownerId: string;
  projectId: string;
  role: "canonical" | "alternate";
  fileName: string;
  contentType: string;
  size: number;
}) {
  if (!input.contentType.startsWith("image/")) throw new Error("Only image uploads are supported");
  if (!Number.isFinite(input.size) || input.size < 1 || input.size > 15 * 1024 * 1024) {
    throw new Error("Image size must be between 1 byte and 15 MB");
  }
  const relativePath = `${projectPrefix(input.ownerId, input.projectId)}/inputs/${input.role}-${randomUUID()}-${safeSegment(input.fileName)}`;
  const fullPath = `${privateObjectDirectory()}/${relativePath}`;
  return {
    uploadUrl: await signedUrl(fullPath, "PUT"),
    objectPath: fullPathToObjectPath(fullPath),
    expiresInSeconds: SIGNED_URL_TTL_SECONDS,
    requiredHeaders: { "content-type": input.contentType },
  };
}

export async function readObjectAsDataUrl(ownerId: string, projectId: string, objectPath: string) {
  assertProjectObjectPath(ownerId, projectId, objectPath);
  const response = await fetch(await signedUrl(objectPathToFullPath(objectPath), "GET"));
  if (!response.ok) throw new Error("Uploaded image could not be read");
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  if (!contentType.startsWith("image/")) throw new Error("Uploaded object is not an image");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > 15 * 1024 * 1024) throw new Error("Uploaded image has an invalid size");
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

export async function readObjectBytes(ownerId: string, projectId: string, objectPath: string) {
  assertProjectObjectPath(ownerId, projectId, objectPath);
  const response = await fetch(await signedUrl(objectPathToFullPath(objectPath), "GET"));
  if (!response.ok) throw new Error("Stored artifact could not be read");
  return Buffer.from(await response.arrayBuffer());
}

export async function storeGeneratedArtifact(input: {
  ownerId: string;
  projectId: string;
  fileName: string;
  contentType: string;
  bytes: Buffer;
}) {
  const relativePath = `${projectPrefix(input.ownerId, input.projectId)}/generated/${randomUUID()}-${safeSegment(input.fileName)}`;
  const fullPath = `${privateObjectDirectory()}/${relativePath}`;
  const upload = await fetch(await signedUrl(fullPath, "PUT"), {
    method: "PUT",
    headers: { "content-type": input.contentType },
    body: input.bytes,
  });
  if (!upload.ok) throw new Error("Generated artifact could not be stored");
  const objectPath = fullPathToObjectPath(fullPath);
  return {
    objectPath,
    downloadUrl: await signedUrl(fullPath, "GET"),
    expiresInSeconds: SIGNED_URL_TTL_SECONDS,
  };
}
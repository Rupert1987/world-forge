import { randomUUID } from "node:crypto";
import { logger } from "./logger";
import {
  createAnalysisJob,
  findPersistedProject,
  getAnalysisJob,
  loadPersistedProjectsForOwner,
  savePersistedProject,
  updateAnalysisJob,
} from "./persistence";
import { internalRequestHeaders } from "./internal-auth";
import {
  createProjectUploadUrl,
  readObjectAsDataUrl,
  storeGeneratedArtifact,
} from "./worldforge-storage";
import { computeExportReadiness } from "./evidence-gates";

function internalApiUrl(path: string) {
  const port = process.env.PORT;
  if (!port) throw new Error("PORT is not configured");
  return `http://127.0.0.1:${port}/api${path}`;
}

async function internalJson<T = Record<string, unknown>>(path: string, ownerId: string, init?: RequestInit): Promise<T> {
  const response = await fetch(internalApiUrl(path), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...internalRequestHeaders(ownerId),
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) {
    throw new Error(body?.error ?? `World Forge request failed with ${response.status}`);
  }
  if (body === null) throw new Error("World Forge returned an empty response");
  return body;
}

export async function listAgentProjects(ownerId: string) {
  const projects = await loadPersistedProjectsForOwner(ownerId);
  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    imageName: project.imageName,
    status: project.status,
    updatedAt: project.updatedAt,
    confidence: typeof (project.analysis as { confidence?: unknown } | null)?.confidence === "number"
      ? (project.analysis as { confidence: number }).confidence
      : null,
  }));
}

export async function getAgentProject(ownerId: string, projectId: string) {
  const project = await findPersistedProject(projectId);
  if (!project || project.ownerId !== ownerId) throw new Error("Project not found");
  return project;
}

export async function storeAgentImage(
  ownerId: string,
  projectId: string,
  input: { role: "canonical" | "alternate"; objectPath?: string; imageData?: string; imageName?: string },
) {
  const project = await getAgentProject(ownerId, projectId);
  let objectPath = input.objectPath;
  if (!objectPath && input.imageData?.startsWith("data:image/")) {
    const match = input.imageData.match(/^data:([^;,]+);base64,(.+)$/s);
    if (!match) throw new Error("imageData must be a base64 image data URL");
    objectPath = (await storeGeneratedArtifact({
      ownerId,
      projectId,
      fileName: input.imageName ?? `${input.role}.png`,
      contentType: match[1]!,
      bytes: Buffer.from(match[2]!, "base64"),
    })).objectPath;
  }
  if (!objectPath) throw new Error("objectPath is required");
  await readObjectAsDataUrl(ownerId, projectId, objectPath);
  const referenceImagePaths = project.referenceImagePaths ?? [];
  if (input.role === "alternate" && referenceImagePaths.length >= 8) {
    throw new Error("A project supports at most 8 alternate views");
  }
  const updated = {
    ...project,
    imageName: input.imageName?.trim() || project.imageName,
    canonicalImageData: null,
    referenceImages: [],
    canonicalImagePath: input.role === "canonical" ? objectPath : project.canonicalImagePath,
    referenceImagePaths: input.role === "alternate" ? [...referenceImagePaths, objectPath] : referenceImagePaths,
    updatedAt: new Date().toISOString(),
  };
  await savePersistedProject(updated);
  return {
    projectId,
    role: input.role,
    imageName: updated.imageName,
    objectPath,
    alternateViewCount: updated.referenceImagePaths.length,
    hasCanonicalView: Boolean(updated.canonicalImagePath),
  };
}

export async function requestAgentUpload(
  ownerId: string,
  projectId: string,
  input: { role: "canonical" | "alternate"; fileName: string; contentType: string; size: number },
) {
  await getAgentProject(ownerId, projectId);
  return createProjectUploadUrl({ ownerId, projectId, ...input });
}

export async function createAgentProject(ownerId: string, input: { name: string; imageName: string }) {
  const project = await internalJson<{
    id: string;
    name: string;
    imageName: string;
    status: string;
    updatedAt: string;
    analysis: unknown;
  }>("/projects", ownerId, {
    method: "POST",
    body: JSON.stringify(input),
  });
  await savePersistedProject({
    id: project.id,
    ownerId,
    name: project.name,
    imageName: project.imageName,
    status: project.status,
    updatedAt: project.updatedAt,
    analysis: project.analysis,
  });
  return { ...project, ownerId: undefined };
}

async function runAnalysisJob(jobId: string, projectId: string, input: unknown) {
  let originalProject: Awaited<ReturnType<typeof findPersistedProject>>;
  try {
    await updateAnalysisJob(jobId, { status: "analyzing", progress: 10 });
    const project = await findPersistedProject(projectId);
    if (!project) throw new Error("Project not found");
    originalProject = project;
    const supplied = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const imageData = typeof supplied.imageData === "string"
      ? supplied.imageData
      : project.canonicalImagePath
        ? await readObjectAsDataUrl(project.ownerId, projectId, project.canonicalImagePath)
        : undefined;
    const referenceImages = Array.isArray(supplied.referenceImages)
      ? supplied.referenceImages
      : await Promise.all((project.referenceImagePaths ?? []).map((path) =>
          readObjectAsDataUrl(project.ownerId, projectId, path)));
    const result = await internalJson(`/projects/${encodeURIComponent(projectId)}/analysis`, project.ownerId, {
      method: "POST",
      body: JSON.stringify({ ...supplied, imageData, referenceImages }),
    });
    const analyzedProject = await findPersistedProject(projectId);
    if (analyzedProject) {
      analyzedProject.canonicalImageData = null;
      analyzedProject.referenceImages = [];
      analyzedProject.canonicalImagePath = project.canonicalImagePath;
      analyzedProject.referenceImagePaths = project.referenceImagePaths ?? [];
      if (analyzedProject.depthMapPreview) {
        const artifact = await storeGeneratedArtifact({
          ownerId: project.ownerId,
          projectId,
          fileName: "depth-map.png",
          contentType: "image/png",
          bytes: analyzedProject.depthMapPreview,
        });
        analyzedProject.depthMapPreviewPath = artifact.objectPath;
        analyzedProject.depthMapPreview = null;
      }
      await savePersistedProject(analyzedProject);
    }
    await updateAnalysisJob(jobId, { status: "completed", progress: 100, result });
  } catch (error) {
    logger.error({ err: error, jobId, projectId }, "Agent analysis job failed");
    if (originalProject) {
      const current = await findPersistedProject(projectId);
      if (current) {
        await savePersistedProject({
          ...current,
          status: originalProject.status,
          analysis: originalProject.analysis,
          depthMapPreview: originalProject.depthMapPreview,
          depthMapPreviewPath: originalProject.depthMapPreviewPath,
          canonicalImageData: null,
          referenceImages: [],
          canonicalImagePath: originalProject.canonicalImagePath,
          referenceImagePaths: originalProject.referenceImagePaths ?? [],
          exportBundlePath: originalProject.exportBundlePath,
        });
      }
    }
    await updateAnalysisJob(jobId, {
      status: "failed",
      progress: 100,
      error: error instanceof Error ? error.message : "Analysis failed",
    });
  }
}

export async function startAgentAnalysis(ownerId: string, projectId: string, input: unknown) {
  const project = await getAgentProject(ownerId, projectId);
  const supplied = input && typeof input === "object" ? input as Record<string, unknown> : {};
  if (typeof supplied.imageData !== "string" && !project.canonicalImagePath && !project.canonicalImageData) {
    throw new Error("Upload and attach a canonical view before starting analysis");
  }
  const jobId = `job-${randomUUID()}`;
  await createAnalysisJob(projectId, jobId);
  void runAnalysisJob(jobId, projectId, supplied);
  return {
    id: jobId,
    projectId,
    status: "queued",
    progress: 0,
    statusUrl: `/api/v1/analysis-jobs/${jobId}`,
  };
}

export async function getAgentAnalysisJob(ownerId: string, jobId: string) {
  const job = await getAnalysisJob(jobId);
  if (!job) throw new Error("Analysis job not found");
  await getAgentProject(ownerId, job.projectId);
  return {
    id: job.id,
    projectId: job.projectId,
    status: job.status,
    progress: job.progress,
    error: job.error,
    result: job.status === "completed" ? job.result : undefined,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

export async function exportAgentProject(ownerId: string, projectId: string) {
  const project = await getAgentProject(ownerId, projectId);
  const readiness = computeExportReadiness(project.analysis as Record<string, unknown> | null);
  if (!readiness.exportReadyCm) {
    throw new Error(
      `Full Unreal cm export requires scale-locked geometry (tier=${readiness.tier}; failing=${readiness.failingChecks.join(",") || "none"}). Analysis status alone is not enough.`,
    );
  }
  const bundle = await internalJson<{
    filename: string;
    generatedAt: string;
  } & Record<string, unknown>>(`/projects/${encodeURIComponent(projectId)}/export`, ownerId);
  const artifact = await storeGeneratedArtifact({
    ownerId,
    projectId,
    fileName: bundle.filename,
    contentType: "application/json",
    bytes: Buffer.from(JSON.stringify(bundle), "utf8"),
  });
  await savePersistedProject({ ...project, exportBundlePath: artifact.objectPath });
  return {
    projectId,
    filename: bundle.filename,
    generatedAt: bundle.generatedAt,
    ...artifact,
  };
}

export async function reviewAgentConfidence(ownerId: string, projectId: string) {
  const project = await getAgentProject(ownerId, projectId);
  const analysis = project.analysis as Record<string, unknown> | null;
  const validations = Array.isArray(analysis?.validations) ? analysis.validations : [];
  const readiness = computeExportReadiness(analysis);
  return {
    projectId: project.id,
    status: project.status,
    confidence: analysis?.confidence ?? null,
    confidenceBreakdown: analysis?.confidenceBreakdown ?? null,
    geometryVerification: analysis?.geometryVerification ?? null,
    cameraGeometryVerification: analysis?.cameraGeometryVerification ?? null,
    criticalWarnings: validations.filter((item) =>
      Boolean(item && typeof item === "object" && (item as { severity?: unknown }).severity === "critical")),
    validations,
    exportTier: readiness.tier,
    exportReady: readiness.exportReady,
    exportReadyCm: readiness.exportReadyCm,
    exportReadyDraft: readiness.exportReadyDraft,
    failingChecks: readiness.failingChecks,
  };
}
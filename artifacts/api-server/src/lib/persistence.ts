import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  worldforgeAnalysisJobs,
  worldforgeApiKeys,
  worldforgeProjects,
} from "@workspace/db";

export type PersistedProject = {
  id: string;
  ownerId: string;
  name: string;
  imageName: string;
  status: string;
  updatedAt: string;
  analysis: unknown;
  depthMapPreview?: Buffer | null;
  canonicalImageData?: string | null;
  referenceImages?: string[] | null;
  canonicalImagePath?: string | null;
  referenceImagePaths?: string[] | null;
  depthMapPreviewPath?: string | null;
  exportBundlePath?: string | null;
};

function asIsoDate(value: Date | string | null | undefined) {
  return value instanceof Date
    ? value.toISOString()
    : (value ?? new Date().toISOString());
}

function rowToProject(
  row: typeof worldforgeProjects.$inferSelect,
): PersistedProject {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    imageName: row.imageName,
    status: row.status,
    updatedAt: asIsoDate(row.updatedAt),
    analysis: row.analysis,
    depthMapPreview: row.depthMapPreview,
    canonicalImageData: row.canonicalImageData,
    referenceImages: Array.isArray(row.referenceImages)
      ? (row.referenceImages as string[])
      : [],
    canonicalImagePath: row.canonicalImagePath,
    referenceImagePaths: Array.isArray(row.referenceImagePaths)
      ? (row.referenceImagePaths as string[])
      : [],
    depthMapPreviewPath: row.depthMapPreviewPath,
    exportBundlePath: row.exportBundlePath,
  };
}

export async function loadPersistedProjects(): Promise<PersistedProject[]> {
  const rows = await db
    .select()
    .from(worldforgeProjects)
    .orderBy(desc(worldforgeProjects.updatedAt));
  return rows.map(rowToProject);
}

export async function loadPersistedProjectsForOwner(
  ownerId: string,
): Promise<PersistedProject[]> {
  const rows = await db
    .select()
    .from(worldforgeProjects)
    .where(eq(worldforgeProjects.ownerId, ownerId))
    .orderBy(desc(worldforgeProjects.updatedAt));
  return rows.map(rowToProject);
}

export async function savePersistedProject(project: PersistedProject) {
  await db
    .insert(worldforgeProjects)
    .values({
      id: project.id,
      ownerId: project.ownerId,
      name: project.name,
      imageName: project.imageName,
      status: project.status,
      analysis: project.analysis as Record<string, unknown>,
      depthMapPreview: project.depthMapPreview ?? null,
      canonicalImageData: project.canonicalImageData ?? null,
      referenceImages: project.referenceImages ?? [],
      canonicalImagePath: project.canonicalImagePath ?? null,
      referenceImagePaths: project.referenceImagePaths ?? [],
      depthMapPreviewPath: project.depthMapPreviewPath ?? null,
      exportBundlePath: project.exportBundlePath ?? null,
      updatedAt: new Date(project.updatedAt),
    })
    .onConflictDoUpdate({
      target: worldforgeProjects.id,
      set: {
        name: project.name,
        imageName: project.imageName,
        status: project.status,
        analysis: project.analysis as Record<string, unknown>,
        depthMapPreview: project.depthMapPreview ?? null,
        canonicalImageData: project.canonicalImageData ?? null,
        referenceImages: project.referenceImages ?? [],
        canonicalImagePath: project.canonicalImagePath ?? null,
        referenceImagePaths: project.referenceImagePaths ?? [],
        depthMapPreviewPath: project.depthMapPreviewPath ?? null,
        exportBundlePath: project.exportBundlePath ?? null,
        updatedAt: new Date(project.updatedAt),
      },
    });
}

export async function findPersistedProject(projectId: string) {
  const [row] = await db
    .select()
    .from(worldforgeProjects)
    .where(eq(worldforgeProjects.id, projectId))
    .limit(1);
  return row ? rowToProject(row) : undefined;
}

export type AnalysisJobStatus = "queued" | "analyzing" | "completed" | "failed";

export async function createAnalysisJob(projectId: string, id: string) {
  const now = new Date();
  await db.insert(worldforgeAnalysisJobs).values({
    id,
    projectId,
    status: "queued",
    progress: 0,
    createdAt: now,
    updatedAt: now,
  });
}

export async function updateAnalysisJob(
  id: string,
  update: {
    status?: AnalysisJobStatus;
    progress?: number;
    error?: string | null;
    result?: unknown;
  },
) {
  await db
    .update(worldforgeAnalysisJobs)
    .set({
      ...(update.status ? { status: update.status } : {}),
      ...(typeof update.progress === "number"
        ? { progress: update.progress }
        : {}),
      ...(update.error !== undefined ? { error: update.error } : {}),
      ...(update.result !== undefined
        ? { result: update.result as Record<string, unknown> }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(worldforgeAnalysisJobs.id, id));
}

export async function getAnalysisJob(id: string) {
  const [row] = await db
    .select()
    .from(worldforgeAnalysisJobs)
    .where(eq(worldforgeAnalysisJobs.id, id))
    .limit(1);
  return row;
}

export async function listActiveAnalysisJobs() {
  return db
    .select()
    .from(worldforgeAnalysisJobs)
    .where(
      and(
        eq(worldforgeAnalysisJobs.status, "analyzing"),
        isNull(worldforgeAnalysisJobs.error),
      ),
    );
}

export async function recoverInterruptedAnalysisJobs() {
  const now = new Date();
  const interrupted = await db
    .update(worldforgeAnalysisJobs)
    .set({
      status: "failed",
      progress: 100,
      error:
        "Analysis interrupted because the server restarted. Start a new analysis job.",
      updatedAt: now,
    })
    .where(inArray(worldforgeAnalysisJobs.status, ["queued", "analyzing"]))
    .returning({
      id: worldforgeAnalysisJobs.id,
    });
  await db
    .update(worldforgeProjects)
    .set({
      status: sql`case
        when ${worldforgeProjects.analysis}->'calibrationEvidence'->>'canonicalImageSha256' is not null
          and ${worldforgeProjects.analysis}->'calibrationEvidence'->>'canonicalImageSha256' <> 'seed-analysis'
        then 'ready'
        else 'draft'
      end`,
      updatedAt: now,
    })
    .where(eq(worldforgeProjects.status, "analyzing"));
  return interrupted.length;
}

export async function createApiKeyRecord(input: {
  id: string;
  ownerId: string;
  label: string;
  keyPrefix: string;
  keyHash: string;
}) {
  const [row] = await db.insert(worldforgeApiKeys).values(input).returning({
    id: worldforgeApiKeys.id,
    label: worldforgeApiKeys.label,
    keyPrefix: worldforgeApiKeys.keyPrefix,
    createdAt: worldforgeApiKeys.createdAt,
  });
  return row;
}

export async function findActiveApiKey(keyHash: string) {
  const [row] = await db
    .select()
    .from(worldforgeApiKeys)
    .where(
      and(
        eq(worldforgeApiKeys.keyHash, keyHash),
        isNull(worldforgeApiKeys.revokedAt),
      ),
    )
    .limit(1);
  return row;
}

export async function touchApiKey(id: string) {
  await db
    .update(worldforgeApiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(worldforgeApiKeys.id, id));
}

export async function listApiKeyRecords(ownerId: string) {
  return db
    .select({
      id: worldforgeApiKeys.id,
      label: worldforgeApiKeys.label,
      keyPrefix: worldforgeApiKeys.keyPrefix,
      createdAt: worldforgeApiKeys.createdAt,
      lastUsedAt: worldforgeApiKeys.lastUsedAt,
      revokedAt: worldforgeApiKeys.revokedAt,
    })
    .from(worldforgeApiKeys)
    .where(eq(worldforgeApiKeys.ownerId, ownerId))
    .orderBy(desc(worldforgeApiKeys.createdAt));
}

export async function revokeApiKey(id: string, ownerId: string) {
  const [revoked] = await db
    .update(worldforgeApiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(worldforgeApiKeys.id, id),
        eq(worldforgeApiKeys.ownerId, ownerId),
        isNull(worldforgeApiKeys.revokedAt),
      ),
    )
    .returning({ id: worldforgeApiKeys.id });
  return Boolean(revoked);
}

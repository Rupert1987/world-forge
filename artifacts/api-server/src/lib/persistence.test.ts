import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

test(
  "persists completed analysis data and depth previews through recovery",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const [{ eq }, { db, pool, worldforgeProjects }, persistence] =
      await Promise.all([
      import("drizzle-orm"),
      import("@workspace/db"),
      import("./persistence"),
    ]);
    const projectId = `persistence-test-${randomUUID()}`;
    const ownerId = "persistence-test-owner";
    const depthMapPreview = Buffer.from("world-forge-depth-preview");
    const analysis = {
      confidence: 0.91,
      confidenceBreakdown: {
        visualDetection: 0.9,
        scaleCalibration: 0.8,
        depthInference: 0.92,
        coverageCompleteness: 0.9,
        spatialConsistency: 0.95,
        overall: 0.91,
      },
      geometryVerification: {
        status: "registered",
        registrations: [{ imageSha256: "alternate-view" }],
      },
      denseDepth: {
        checksumSha256: "depth-checksum",
        inputImageSha256: "canonical-view",
      },
      calibrationEvidence: {
        canonicalImageSha256: "canonical-view",
      },
    };

    try {
      await persistence.savePersistedProject({
        id: projectId,
        ownerId,
        name: "Persistence test",
        imageName: "concept.png",
        status: "analyzing",
        updatedAt: new Date().toISOString(),
        analysis,
        depthMapPreview,
        referenceImages: [],
      });

      await persistence.recoverInterruptedAnalysisJobs();
      const recovered = await persistence.findPersistedProject(projectId);

      assert.ok(recovered);
      assert.equal(recovered.status, "ready");
      assert.deepEqual(recovered.analysis, analysis);
      assert.ok(Buffer.isBuffer(recovered.depthMapPreview));
      assert.deepEqual(recovered.depthMapPreview, depthMapPreview);
    } finally {
      await db
        .delete(worldforgeProjects)
        .where(eq(worldforgeProjects.id, projectId));
      await pool.end();
    }
  },
);

import { Router, type IRouter } from "express";
import { authenticateApiKey } from "../lib/api-auth";
import {
  createAgentProject,
  exportAgentProject,
  getAgentAnalysisJob,
  getAgentProject,
  listAgentProjects,
  requestAgentUpload,
  reviewAgentConfidence,
  startAgentAnalysis,
  storeAgentImage,
} from "../lib/agent-service";

const router: IRouter = Router();
router.use("/v1", authenticateApiKey);

router.get("/v1/projects", async (req, res) => {
  res.json(await listAgentProjects(req.worldForgeOwnerId!));
});

router.post("/v1/projects", async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const imageName = typeof req.body?.imageName === "string" ? req.body.imageName.trim() : "";
  if (!name || !imageName) {
    res.status(400).json({ error: "name and imageName are required" });
    return;
  }
  res.status(201).json(await createAgentProject(req.worldForgeOwnerId!, { name, imageName }));
});

router.get("/v1/projects/:projectId", async (req, res) => {
  try {
    res.json(await getAgentProject(req.worldForgeOwnerId!, String(req.params["projectId"])));
  } catch {
    res.status(404).json({ error: "Project not found" });
  }
});

router.post("/v1/projects/:projectId/assets", async (req, res) => {
  const role = req.body?.role;
  const objectPath = typeof req.body?.objectPath === "string" ? req.body.objectPath : undefined;
  const imageData = typeof req.body?.imageData === "string" ? req.body.imageData : undefined;
  if ((role !== "canonical" && role !== "alternate") || (!objectPath && !imageData)) {
    res.status(400).json({ error: "role and objectPath are required" });
    return;
  }
  try {
    res.status(201).json(await storeAgentImage(req.worldForgeOwnerId!, String(req.params["projectId"]), {
      role,
      objectPath,
      imageData,
      imageName: typeof req.body?.imageName === "string" ? req.body.imageName : undefined,
    }));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Image upload failed" });
  }
});

router.post("/v1/projects/:projectId/assets/upload-url", async (req, res) => {
  const role = req.body?.role;
  const fileName = typeof req.body?.fileName === "string" ? req.body.fileName.trim() : "";
  const contentType = typeof req.body?.contentType === "string" ? req.body.contentType.trim() : "";
  const size = Number(req.body?.size);
  if ((role !== "canonical" && role !== "alternate") || !fileName || !contentType || !Number.isFinite(size)) {
    res.status(400).json({ error: "role, fileName, contentType and size are required" });
    return;
  }
  try {
    res.json(await requestAgentUpload(req.worldForgeOwnerId!, String(req.params["projectId"]), {
      role,
      fileName,
      contentType,
      size,
    }));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Upload request failed" });
  }
});

router.post("/v1/projects/:projectId/analysis", async (req, res) => {
  try {
    const job = await startAgentAnalysis(req.worldForgeOwnerId!, String(req.params["projectId"]), req.body);
    res.status(202).json(job);
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : "Project not found" });
  }
});

router.get("/v1/analysis-jobs/:jobId", async (req, res) => {
  try {
    res.json(await getAgentAnalysisJob(req.worldForgeOwnerId!, String(req.params["jobId"])));
  } catch {
    res.status(404).json({ error: "Analysis job not found" });
  }
});

router.get("/v1/projects/:projectId/confidence", async (req, res) => {
  try {
    res.json(await reviewAgentConfidence(req.worldForgeOwnerId!, String(req.params["projectId"])));
  } catch {
    res.status(404).json({ error: "Project not found" });
  }
});

router.get("/v1/projects/:projectId/export", async (req, res) => {
  try {
    res.json(await exportAgentProject(req.worldForgeOwnerId!, String(req.params["projectId"])));
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : "Project not found" });
  }
});

export default router;
import { Router, type IRouter, type Request } from "express";
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

const tools = [
  { name: "worldforge_list_projects", description: "List World Forge projects available to this API key.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "worldforge_create_project", description: "Create a World Forge project before uploading or analyzing concept views.", inputSchema: { type: "object", required: ["name", "imageName"], properties: { name: { type: "string" }, imageName: { type: "string" } }, additionalProperties: false } },
  { name: "worldforge_get_project", description: "Read a project and its latest persisted world analysis.", inputSchema: { type: "object", required: ["projectId"], properties: { projectId: { type: "string" } }, additionalProperties: false } },
  { name: "worldforge_request_upload", description: "Create a 15-minute signed PUT URL for one project image. Upload bytes with the returned content-type header, then attach objectPath.", inputSchema: { type: "object", required: ["projectId", "role", "fileName", "contentType", "size"], properties: { projectId: { type: "string" }, role: { type: "string", enum: ["canonical", "alternate"] }, fileName: { type: "string" }, contentType: { type: "string", pattern: "^image/" }, size: { type: "number", minimum: 1, maximum: 15728640 } }, additionalProperties: false } },
  { name: "worldforge_attach_uploaded_view", description: "Attach a successfully uploaded objectPath as the canonical or an alternate project view.", inputSchema: { type: "object", required: ["projectId", "role", "objectPath"], properties: { projectId: { type: "string" }, role: { type: "string", enum: ["canonical", "alternate"] }, objectPath: { type: "string", pattern: "^/objects/" }, imageName: { type: "string" } }, additionalProperties: false } },
  { name: "worldforge_start_analysis", description: "Start asynchronous world analysis using the project's attached views.", inputSchema: { type: "object", required: ["projectId", "mapWidthMeters", "mapDepthMeters", "gridSizeMeters"], properties: { projectId: { type: "string" }, mapWidthMeters: { type: "number", minimum: 100 }, mapDepthMeters: { type: "number", minimum: 100 }, gridSizeMeters: { type: "number", minimum: 10 }, knownScale: { type: ["number", "null"] }, knownScalePixelDistance: { type: ["number", "null"] } }, additionalProperties: false } },
  { name: "worldforge_get_analysis_job", description: "Poll an asynchronous analysis job until status is completed or failed.", inputSchema: { type: "object", required: ["jobId"], properties: { jobId: { type: "string" } }, additionalProperties: false } },
  { name: "worldforge_review_confidence", description: "Review confidence, registration evidence, camera-pose verification and critical warnings before export.", inputSchema: { type: "object", required: ["projectId"], properties: { projectId: { type: "string" } }, additionalProperties: false } },
  { name: "worldforge_export_unreal", description: "Generate an Unreal-ready bundle in object storage and return a short-lived download URL.", inputSchema: { type: "object", required: ["projectId"], properties: { projectId: { type: "string" } }, additionalProperties: false } },
] as const;

function textResult(value: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

async function callTool(req: Request, name: string, args: Record<string, unknown>) {
  const ownerId = req.worldForgeOwnerId!;
  if (name === "worldforge_list_projects") return listAgentProjects(ownerId);
  if (name === "worldforge_create_project") return createAgentProject(ownerId, { name: String(args.name ?? ""), imageName: String(args.imageName ?? "") });
  if (name === "worldforge_get_project") return getAgentProject(ownerId, String(args.projectId ?? ""));
  if (name === "worldforge_request_upload") {
    if (args.role !== "canonical" && args.role !== "alternate") throw new Error("role must be canonical or alternate");
    return requestAgentUpload(ownerId, String(args.projectId ?? ""), {
      role: args.role,
      fileName: String(args.fileName ?? ""),
      contentType: String(args.contentType ?? ""),
      size: Number(args.size),
    });
  }
  if (name === "worldforge_attach_uploaded_view") {
    if (args.role !== "canonical" && args.role !== "alternate") throw new Error("role must be canonical or alternate");
    return storeAgentImage(ownerId, String(args.projectId ?? ""), { role: args.role, objectPath: String(args.objectPath ?? ""), imageName: typeof args.imageName === "string" ? args.imageName : undefined });
  }
  if (name === "worldforge_start_analysis") {
    const { projectId, ...input } = args;
    return startAgentAnalysis(ownerId, String(projectId ?? ""), input);
  }
  if (name === "worldforge_get_analysis_job") return getAgentAnalysisJob(ownerId, String(args.jobId ?? ""));
  if (name === "worldforge_review_confidence") return reviewAgentConfidence(ownerId, String(args.projectId ?? ""));
  if (name === "worldforge_export_unreal") return exportAgentProject(ownerId, String(args.projectId ?? ""));
  throw new Error(`Unknown tool: ${name}`);
}

router.post("/mcp", authenticateApiKey, async (req, res) => {
  const { id = null, method, params } = req.body ?? {};
  try {
    if (method === "initialize") {
      res.json({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "world-forge", version: "1.0.0" } } });
      return;
    }
    if (method === "notifications/initialized") {
      res.status(202).end();
      return;
    }
    if (method === "tools/list") {
      res.json({ jsonrpc: "2.0", id, result: { tools } });
      return;
    }
    if (method === "tools/call") {
      try {
        const result = await callTool(req, String(params?.name ?? ""), params?.arguments ?? {});
        res.json({ jsonrpc: "2.0", id, result: textResult(result) });
      } catch (error) {
        req.log.warn({ err: error, tool: params?.name }, "World Forge MCP tool call failed");
        res.json({
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [{ type: "text", text: error instanceof Error ? error.message : "World Forge tool call failed" }],
          },
        });
      }
      return;
    }
    res.status(400).json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  } catch (error) {
    res.status(400).json({ jsonrpc: "2.0", id, error: { code: -32000, message: error instanceof Error ? error.message : "Tool call failed" } });
  }
});

export default router;
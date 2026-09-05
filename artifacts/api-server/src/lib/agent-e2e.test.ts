import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, worldforgeAnalysisJobs, worldforgeApiKeys, worldforgeProjects } from "@workspace/db";
import { createApiKey } from "./api-auth";

type Json = Record<string, any>;

test(
  "completes create, signed upload, analysis, review and export through REST and MCP",
  {
    skip:
      process.env.WORLDFORGE_RUN_E2E !== "1" ||
      !process.env.WORLDFORGE_E2E_ORIGIN,
    timeout: 600_000,
  },
  async () => {
    const ownerId = `agent-e2e-${Date.now()}-${process.pid}`;
    const apiKey = await createApiKey("Agent end-to-end test", ownerId);
    const origin = `${process.env.WORLDFORGE_E2E_ORIGIN!.replace(/\/+$/, "")}/api`;
    const imageBytes = await readFile("../world-forge/src/assets/world-reference.jpg");
    const projectIds: string[] = [];

    async function api(path: string, init: RequestInit = {}) {
      const response = await fetch(`${origin}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${apiKey.key}`,
          "content-type": "application/json",
          ...(init.headers ?? {}),
        },
      });
      const body = await response.json().catch(() => null);
      assert.equal(response.ok, true, `${init.method ?? "GET"} ${path}: ${JSON.stringify(body)}`);
      return body as Json;
    }

    async function upload(uploadUrl: string) {
      const response = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "content-type": "image/jpeg" },
        body: imageBytes,
      });
      assert.equal(response.ok, true, `signed upload failed with ${response.status}`);
    }

    async function waitForRestJob(jobId: string) {
      for (let attempt = 0; attempt < 240; attempt += 1) {
        const job = await api(`/v1/analysis-jobs/${jobId}`);
        if (job.status === "completed") return job;
        assert.notEqual(job.status, "failed", job.error ?? "analysis failed");
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      assert.fail("analysis did not complete within four minutes");
    }

    let rpcId = 0;
    async function mcp(method: string, params?: Json) {
      const envelope = await api("/mcp", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
      });
      assert.equal(envelope.error, undefined, JSON.stringify(envelope.error));
      return envelope.result as Json;
    }

    async function tool(name: string, args: Json = {}) {
      const result = await mcp("tools/call", { name, arguments: args });
      assert.notEqual(result.isError, true, result.content?.[0]?.text);
      return JSON.parse(result.content[0].text) as Json;
    }

    try {
      const restProject = await api("/v1/projects", {
        method: "POST",
        body: JSON.stringify({ name: "REST full run", imageName: "world-reference.jpg" }),
      });
      projectIds.push(restProject.id);
      const restUpload = await api(`/v1/projects/${restProject.id}/assets/upload-url`, {
        method: "POST",
        body: JSON.stringify({
          role: "canonical",
          fileName: "world-reference.jpg",
          contentType: "image/jpeg",
          size: imageBytes.length,
        }),
      });
      await upload(restUpload.uploadUrl);
      await api(`/v1/projects/${restProject.id}/assets`, {
        method: "POST",
        body: JSON.stringify({ role: "canonical", objectPath: restUpload.objectPath }),
      });
      const restJob = await api(`/v1/projects/${restProject.id}/analysis`, {
        method: "POST",
        body: JSON.stringify({ mapWidthMeters: 1200, mapDepthMeters: 900, gridSizeMeters: 25 }),
      });
      await waitForRestJob(restJob.id);
      const restReview = await api(`/v1/projects/${restProject.id}/confidence`);
      assert.equal(typeof restReview.confidence, "number");
      const restExport = await api(`/v1/projects/${restProject.id}/export`);
      assert.match(restExport.objectPath, /^\/objects\//);
      assert.equal((await fetch(restExport.downloadUrl)).ok, true);

      await mcp("initialize", {});
      const listed = await mcp("tools/list");
      assert.ok(listed.tools.some((item: Json) => item.name === "worldforge_request_upload"));
      const mcpProject = await tool("worldforge_create_project", {
        name: "MCP full run",
        imageName: "world-reference.jpg",
      });
      projectIds.push(mcpProject.id);
      const mcpUpload = await tool("worldforge_request_upload", {
        projectId: mcpProject.id,
        role: "canonical",
        fileName: "world-reference.jpg",
        contentType: "image/jpeg",
        size: imageBytes.length,
      });
      await upload(mcpUpload.uploadUrl);
      await tool("worldforge_attach_uploaded_view", {
        projectId: mcpProject.id,
        role: "canonical",
        objectPath: mcpUpload.objectPath,
      });
      const mcpJob = await tool("worldforge_start_analysis", {
        projectId: mcpProject.id,
        mapWidthMeters: 1200,
        mapDepthMeters: 900,
        gridSizeMeters: 25,
      });
      for (let attempt = 0; attempt < 240; attempt += 1) {
        const job = await tool("worldforge_get_analysis_job", { jobId: mcpJob.id });
        if (job.status === "completed") break;
        assert.notEqual(job.status, "failed", job.error ?? "analysis failed");
        if (attempt === 239) assert.fail("MCP analysis did not complete within four minutes");
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      const mcpReview = await tool("worldforge_review_confidence", { projectId: mcpProject.id });
      assert.equal(typeof mcpReview.confidence, "number");
      const mcpExport = await tool("worldforge_export_unreal", { projectId: mcpProject.id });
      assert.match(mcpExport.objectPath, /^\/objects\//);
      assert.equal((await fetch(mcpExport.downloadUrl)).ok, true);
    } finally {
      await db.delete(worldforgeAnalysisJobs).where(inArray(worldforgeAnalysisJobs.projectId, projectIds));
      await db.delete(worldforgeProjects).where(inArray(worldforgeProjects.id, projectIds));
      await db.delete(worldforgeApiKeys).where(eq(worldforgeApiKeys.id, apiKey.id));
    }
  },
);
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { createApiKey, getSessionOwnerId } from "../lib/api-auth";
import { listApiKeyRecords, revokeApiKey } from "../lib/persistence";
import { getClerkProxyHost } from "../middlewares/clerkProxyMiddleware";

const router: IRouter = Router();

function requireUser(req: Request, res: Response, next: NextFunction) {
  const ownerId = getSessionOwnerId(req);
  if (!ownerId) {
    res.status(401).json({ error: "Sign in to manage API keys" });
    return;
  }
  req.worldForgeOwnerId = ownerId;
  next();
}

function requireSameOrigin(req: Request, res: Response, next: NextFunction) {
  const origin = req.header("origin");
  const expectedHost = getClerkProxyHost(req);
  try {
    if (!origin || !expectedHost || new URL(origin).host !== expectedHost) {
      res.status(403).json({ error: "Cross-origin request rejected" });
      return;
    }
  } catch {
    res.status(403).json({ error: "Invalid request origin" });
    return;
  }
  next();
}

router.get("/developer/session", requireUser, (req, res) => {
  res.json({ authenticated: true });
});

router.get("/developer/api-keys", requireUser, async (req, res) => {
  const rows = await listApiKeyRecords(req.worldForgeOwnerId!);
  res.json(rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  })));
});

router.post("/developer/api-keys", requireUser, requireSameOrigin, async (req, res) => {
  const label = typeof req.body?.label === "string" ? req.body.label.trim() : "";
  if (label.length < 2 || label.length > 80) {
    res.status(400).json({ error: "Key label must be between 2 and 80 characters" });
    return;
  }
  const created = await createApiKey(label, req.worldForgeOwnerId!);
  res.status(201).json({
    ...created,
    createdAt: created.createdAt.toISOString(),
  });
});

router.delete("/developer/api-keys/:keyId", requireUser, requireSameOrigin, async (req, res) => {
  const keyId = String(req.params["keyId"] ?? "");
  if (!keyId.startsWith("key-")) {
    res.status(400).json({ error: "Invalid API key id" });
    return;
  }
  const revoked = await revokeApiKey(keyId, req.worldForgeOwnerId!);
  if (!revoked) {
    res.status(404).json({ error: "API key not found" });
    return;
  }
  res.status(204).end();
});

export default router;
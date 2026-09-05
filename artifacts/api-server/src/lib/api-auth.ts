import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import {
  createApiKeyRecord,
  findActiveApiKey,
  touchApiKey,
} from "./persistence";
import { AUTH_ENABLED, LOCAL_OWNER_ID } from "./auth-mode";

export const API_KEY_PREFIX = "wf_live_";

export function hashApiKey(rawKey: string) {
  return createHash("sha256").update(rawKey).digest("hex");
}

export function issueApiKey() {
  const rawKey = `${API_KEY_PREFIX}${randomBytes(32).toString("hex")}`;
  return {
    rawKey,
    keyPrefix: rawKey.slice(0, 16),
    keyHash: hashApiKey(rawKey),
  };
}

export function getSessionOwnerId(req: Request) {
  if (!AUTH_ENABLED) return LOCAL_OWNER_ID;
  const auth = getAuth(req);
  return auth.orgId ?? auth.userId ?? undefined;
}

export async function createApiKey(label: string, ownerId: string) {
  const issued = issueApiKey();
  const record = await createApiKeyRecord({
    id: `key-${randomBytes(12).toString("hex")}`,
    ownerId,
    label,
    keyPrefix: issued.keyPrefix,
    keyHash: issued.keyHash,
  });
  return { ...record, key: issued.rawKey };
}

export function resolvePresentedApiKey(headers: {
  authorization?: string | null;
  "x-api-key"?: string | null;
}) {
  const authorization = headers.authorization ?? undefined;
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7).trim();
  const headerKey = headers["x-api-key"] ?? undefined;
  return headerKey?.trim() || undefined;
}

function getBearerToken(req: Request) {
  return resolvePresentedApiKey({
    authorization: req.header("authorization"),
    "x-api-key": req.header("x-api-key"),
  });
}

export async function authenticateApiKey(req: Request, res: Response, next: NextFunction) {
  const rawKey = getBearerToken(req);
  if (!rawKey) {
    res.status(401).json({
      error: "Authentication required",
      message: "Provide an API key with Authorization: Bearer wf_live_... or X-API-Key.",
    });
    return;
  }
  const record = await findActiveApiKey(hashApiKey(rawKey));
  if (!record) {
    res.status(401).json({ error: "Invalid or revoked API key" });
    return;
  }
  void touchApiKey(record.id).catch((error) => req.log.warn({ err: error }, "Could not update API key usage"));
  req.worldForgeApiKeyId = record.id;
  req.worldForgeOwnerId = record.ownerId;
  next();
}

export function requireBootstrapSecret(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.WORLDFORGE_BOOTSTRAP_SECRET;
  const provided = req.header("x-worldforge-bootstrap");
  if (!expected || !provided || provided !== expected) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
}
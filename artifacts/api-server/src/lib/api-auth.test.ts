import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db, worldforgeApiKeys } from "@workspace/db";
import {
  API_KEY_PREFIX,
  createApiKey,
  hashApiKey,
} from "./api-auth";
import {
  findActiveApiKey,
  listApiKeyRecords,
  revokeApiKey,
} from "./persistence";

test("issues hashed, owner-scoped API keys and revokes only for their owner", async () => {
  const suffix = `${Date.now()}-${process.pid}`;
  const ownerId = `api-key-owner-${suffix}`;
  const otherOwnerId = `api-key-other-${suffix}`;
  const created = await createApiKey("Test agent", ownerId);

  try {
    assert.ok(created.key.startsWith(API_KEY_PREFIX));
    assert.equal(created.keyPrefix, created.key.slice(0, 16));

    const stored = await findActiveApiKey(hashApiKey(created.key));
    assert.ok(stored);
    assert.equal(stored.ownerId, ownerId);
    assert.notEqual(stored.keyHash, created.key);

    const ownerKeys = await listApiKeyRecords(ownerId);
    const otherOwnerKeys = await listApiKeyRecords(otherOwnerId);
    assert.equal(ownerKeys.some((key) => key.id === created.id), true);
    assert.equal(otherOwnerKeys.some((key) => key.id === created.id), false);

    assert.equal(await revokeApiKey(created.id, otherOwnerId), false);
    assert.ok(await findActiveApiKey(hashApiKey(created.key)));

    assert.equal(await revokeApiKey(created.id, ownerId), true);
    assert.equal(await findActiveApiKey(hashApiKey(created.key)), undefined);
    assert.equal(await revokeApiKey(created.id, ownerId), false);
  } finally {
    await db
      .delete(worldforgeApiKeys)
      .where(eq(worldforgeApiKeys.id, created.id));
  }
});
import { randomBytes, timingSafeEqual } from "node:crypto";

const internalToken = randomBytes(32).toString("hex");

export function internalRequestHeaders(ownerId: string) {
  return {
    "x-worldforge-internal-token": internalToken,
    "x-worldforge-owner-id": ownerId,
  };
}

export function isInternalRequest(token: string | undefined) {
  if (!token) return false;
  const received = Buffer.from(token);
  const expected = Buffer.from(internalToken);
  return received.length === expected.length && timingSafeEqual(received, expected);
}
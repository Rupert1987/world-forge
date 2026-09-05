import assert from "node:assert/strict";
import test from "node:test";
import { resolvePresentedApiKey } from "./api-auth";

test("resolves API keys from X-API-Key or Bearer", () => {
  assert.equal(
    resolvePresentedApiKey({ "x-api-key": "wf_live_from_header" }),
    "wf_live_from_header",
  );
  assert.equal(
    resolvePresentedApiKey({ authorization: "Bearer wf_live_from_bearer" }),
    "wf_live_from_bearer",
  );
  assert.equal(
    resolvePresentedApiKey({
      authorization: "Bearer wf_live_preferred",
      "x-api-key": "wf_live_secondary",
    }),
    "wf_live_preferred",
  );
  assert.equal(resolvePresentedApiKey({}), undefined);
});

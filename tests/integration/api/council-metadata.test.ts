/**
 * Integration tests for council metadata API routes.
 *
 * Run with: deno test --allow-all --no-check --config tests/deno.json tests/integration/api/council-metadata.test.ts
 */
import { assertEquals, assertExists } from "@std/assert";
import { createMockContext } from "../../test_app.ts";
import { resetDb, ensureInitialized, seedCouncilMetadata, ADMIN_KEYPAIR } from "../../test_helpers.ts";

import {
  getMetadataHandler,
  putMetadataHandler,
  deleteMetadataHandler,
} from "@/http/v1/council/metadata.ts";

// Admin session state (simulates successful JWT middleware)
const adminState = {
  session: {
    sub: ADMIN_KEYPAIR.publicKey(),
    type: "admin",
    exp: Math.floor(Date.now() / 1000) + 3600,
  },
};

// ---------------------------------------------------------------------------
// GET /council/metadata
// ---------------------------------------------------------------------------

Deno.test("GET /council/metadata - auto-creates default on first access", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    method: "GET",
    state: { ...adminState },
  });

  await getMetadataHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.message, "Council metadata retrieved");
  assertEquals(res.body.data.name, "Unnamed Council");
  assertExists(res.body.data.channelAuthId);
  assertExists(res.body.data.councilPublicKey);
});

Deno.test("GET /council/metadata - returns existing metadata", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata({ name: "My Council", description: "Test" });

  const { ctx, getResponse } = createMockContext({
    method: "GET",
    state: { ...adminState },
  });

  await getMetadataHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.data.name, "My Council");
  assertEquals(res.body.data.description, "Test");
});

// ---------------------------------------------------------------------------
// PUT /council/metadata
// ---------------------------------------------------------------------------

Deno.test("PUT /council/metadata - updates metadata", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    method: "PUT",
    body: { name: "Updated Council", description: "New description", contactEmail: "admin@example.com" },
    state: { ...adminState },
  });

  await putMetadataHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.message, "Council metadata updated");
  assertEquals(res.body.data.name, "Updated Council");
  assertEquals(res.body.data.description, "New description");
  assertEquals(res.body.data.contactEmail, "admin@example.com");
});

Deno.test("PUT /council/metadata - rejects missing name", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    method: "PUT",
    body: { description: "No name" },
    state: { ...adminState },
  });

  await putMetadataHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
  assertEquals(res.body.message, "name is required");
});

Deno.test("PUT /council/metadata - rejects name over 200 chars", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    method: "PUT",
    body: { name: "x".repeat(201) },
    state: { ...adminState },
  });

  await putMetadataHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
  assertEquals(res.body.message, "name must be at most 200 characters");
});

// ---------------------------------------------------------------------------
// DELETE /council/metadata
// ---------------------------------------------------------------------------

Deno.test("DELETE /council/metadata - deletes all council data", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata();

  const { ctx, getResponse } = createMockContext({
    method: "DELETE",
    state: { ...adminState },
  });

  await deleteMetadataHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.message, "Council deleted");
});

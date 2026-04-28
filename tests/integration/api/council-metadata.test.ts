/**
 * Integration tests for council metadata API routes.
 *
 * Run with: deno test --allow-all --no-check --config tests/deno.json tests/integration/api/council-metadata.test.ts
 */
import { assertEquals } from "@std/assert";
import { Keypair } from "stellar-sdk";
import { createMockContext } from "../../test_app.ts";
import {
  ADMIN_KEYPAIR,
  ensureInitialized,
  resetDb,
  seedCouncilMetadata,
} from "../../test_helpers.ts";

import {
  deleteMetadataHandler,
  getMetadataHandler,
  putMetadataHandler,
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

Deno.test("GET /council/metadata - returns 404 when no metadata exists", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    method: "GET",
    query: { councilId: "default" },
    state: { ...adminState },
  });

  await getMetadataHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 404);
  assertEquals(res.body.message, "Council not found");
});

Deno.test("GET /council/metadata - returns existing metadata", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata({ name: "My Council", description: "Test" });

  const { ctx, getResponse } = createMockContext({
    method: "GET",
    query: { councilId: "default" },
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
  await seedCouncilMetadata({ name: "Original" });

  const { ctx, getResponse } = createMockContext({
    method: "PUT",
    body: {
      councilId: "default",
      name: "Updated Council",
      description: "New description",
      contactEmail: "admin@example.com",
    },
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
    body: { councilId: "default", description: "No name" },
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
    body: { councilId: "default", name: "x".repeat(201) },
    state: { ...adminState },
  });

  await putMetadataHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
  assertEquals(res.body.message, "name must be at most 200 characters");
});

Deno.test("PUT /council/metadata - partial upsert preserves existing fields", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata({
    name: "Original",
    description: "Keep me",
    councilPublicKey: ADMIN_KEYPAIR.publicKey(),
  });

  const { ctx, getResponse } = createMockContext({
    method: "PUT",
    body: { councilId: "default", name: "Updated" },
    state: { ...adminState },
  });

  await putMetadataHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.data.name, "Updated");
  assertEquals(res.body.data.description, "Keep me");
});

Deno.test("PUT /council/metadata - sets councilPublicKey from session sub", async () => {
  await ensureInitialized();
  await resetDb();
  const otherKeypair = Keypair.random();
  await seedCouncilMetadata({
    name: "Original",
    councilPublicKey: otherKeypair.publicKey(),
  });

  const { ctx, getResponse } = createMockContext({
    method: "PUT",
    body: { councilId: "default", name: "Test" },
    state: {
      session: {
        sub: otherKeypair.publicKey(),
        type: "admin",
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
    },
  });

  await putMetadataHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.data.councilPublicKey, otherKeypair.publicKey());
});

Deno.test("PUT /council/metadata - creates record when none exists", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    method: "PUT",
    body: { councilId: "default", name: "New Council" },
    state: { ...adminState },
  });

  await putMetadataHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.data.name, "New Council");
  assertEquals(res.body.data.councilPublicKey, ADMIN_KEYPAIR.publicKey());
});

Deno.test("PUT /council/metadata - rejects malformed JSON", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    method: "PUT",
    body: undefined,
    state: { ...adminState },
  });

  await putMetadataHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
  assertEquals(res.body.message, "Invalid request body");
});

Deno.test("PUT /council/metadata - rejects description over 2000 chars", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata({ name: "Original" });

  const { ctx, getResponse } = createMockContext({
    method: "PUT",
    body: { councilId: "default", name: "Ok", description: "x".repeat(2001) },
    state: { ...adminState },
  });

  await putMetadataHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
  assertEquals(res.body.message, "description must be at most 2000 characters");
});

Deno.test("PUT /council/metadata - rejects contactEmail over 200 chars", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata({ name: "Original" });

  const { ctx, getResponse } = createMockContext({
    method: "PUT",
    body: { councilId: "default", name: "Ok", contactEmail: "x".repeat(201) },
    state: { ...adminState },
  });

  await putMetadataHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
  assertEquals(res.body.message, "contactEmail must be at most 200 characters");
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
    query: { councilId: "default" },
    state: { ...adminState },
  });

  await deleteMetadataHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.message, "Council deleted");
});

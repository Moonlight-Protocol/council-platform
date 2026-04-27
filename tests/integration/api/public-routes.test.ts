/**
 * Integration tests for public API routes.
 *
 * The GET handlers (/public/council, /public/providers, /public/channels) are
 * defined inline in the router module and are not individually exported. Their
 * underlying data-access logic is covered by the repository integration tests.
 * Here we test:
 *   - Route registration on the router (verifying path + method)
 *   - The join-request handler, which IS exported and can be called directly
 *
 * Run with: deno test --allow-all --no-check --config tests/deno.json tests/integration/api/public-routes.test.ts
 */
import { assertEquals, assertExists } from "@std/assert";
import { createMockContext } from "../../test_app.ts";
import {
  resetDb,
  ensureInitialized,
  seedJoinRequest,
  JoinRequestStatus,
} from "../../test_helpers.ts";
import { Keypair } from "stellar-sdk";

import publicRouter from "@/http/v1/public/routes.ts";
import { ProviderJoinRequestRepository } from "@/persistence/drizzle/repository/provider-join-request.repository.ts";
import { drizzleClient } from "../../test_helpers.ts";
const { createPostJoinRequestHandler } = await import("@/http/v1/public/join-request.ts");
const joinRequestRepo = new ProviderJoinRequestRepository(drizzleClient);
const joinRequestHandler = createPostJoinRequestHandler(joinRequestRepo);

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

Deno.test("publicRouter registers all expected routes", () => {
  const routes = [...publicRouter];

  const council = routes.find((r) => r.path === "/public/council" && r.methods.includes("GET"));
  assertExists(council, "GET /public/council should be registered");

  const councils = routes.find((r) => r.path === "/public/councils" && r.methods.includes("GET"));
  assertExists(councils, "GET /public/councils should be registered");

  const providers = routes.find((r) => r.path === "/public/providers" && r.methods.includes("GET"));
  assertExists(providers, "GET /public/providers should be registered");

  const channels = routes.find((r) => r.path === "/public/channels" && r.methods.includes("GET"));
  assertExists(channels, "GET /public/channels should be registered");

  const knownAssets = routes.find((r) => r.path === "/public/known-assets" && r.methods.includes("GET"));
  assertExists(knownAssets, "GET /public/known-assets should be registered");

  const joinReq = routes.find(
    (r) => r.path === "/public/provider/join-request" && r.methods.includes("POST"),
  );
  assertExists(joinReq, "POST /public/provider/join-request should be registered");
});

// ---------------------------------------------------------------------------
// POST /public/provider/join-request
// ---------------------------------------------------------------------------

Deno.test("POST /public/provider/join-request - creates a join request", async () => {
  await ensureInitialized();
  await resetDb();

  const pk = Keypair.random().publicKey();
  const { ctx, getResponse } = createMockContext({
    method: "POST",
    path: "/public/provider/join-request",
    body: { publicKey: pk, councilId: "default", label: "Test Provider", contactEmail: "test@example.com" },
  });

  await joinRequestHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.message, "Join request submitted");
  assertEquals(res.body.data.publicKey, pk);
  assertEquals(res.body.data.status, "PENDING");
  assertExists(res.body.data.id);
});

Deno.test("POST /public/provider/join-request - rejects missing publicKey", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    path: "/public/provider/join-request",
    body: { councilId: "default", label: "No Key" },
  });

  await joinRequestHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
  assertEquals(res.body.message, "publicKey is required");
});

Deno.test("POST /public/provider/join-request - rejects invalid Stellar key", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    path: "/public/provider/join-request",
    body: { publicKey: "not-a-stellar-key", councilId: "default" },
  });

  await joinRequestHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
  assertEquals(res.body.message, "Invalid Stellar public key format");
});

Deno.test("POST /public/provider/join-request - rejects duplicate pending request", async () => {
  await ensureInitialized();
  await resetDb();

  const pk = Keypair.random().publicKey();
  await seedJoinRequest({ publicKey: pk, status: JoinRequestStatus.PENDING });

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    path: "/public/provider/join-request",
    body: { publicKey: pk, councilId: "default" },
  });

  await joinRequestHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 409);
  assertEquals(res.body.message, "A pending join request already exists for this public key");
});

Deno.test("POST /public/provider/join-request - allows request if previous was approved", async () => {
  await ensureInitialized();
  await resetDb();

  const pk = Keypair.random().publicKey();
  await seedJoinRequest({ publicKey: pk, status: JoinRequestStatus.APPROVED });

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    path: "/public/provider/join-request",
    body: { publicKey: pk, councilId: "default", label: "Second attempt" },
  });

  await joinRequestHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.data.status, "PENDING");
});

Deno.test("POST /public/provider/join-request - rejects label over 200 chars", async () => {
  await ensureInitialized();
  await resetDb();

  const pk = Keypair.random().publicKey();
  const { ctx, getResponse } = createMockContext({
    method: "POST",
    path: "/public/provider/join-request",
    body: { publicKey: pk, councilId: "default", label: "x".repeat(201) },
  });

  await joinRequestHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
  assertEquals(res.body.message, "label must be at most 200 characters");
});

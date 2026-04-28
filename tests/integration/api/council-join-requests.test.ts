/**
 * Integration tests for council join request API routes.
 *
 * Tests listing, approving, and rejecting provider join requests.
 * Note: The approve handler calls callAddProvider which makes real Stellar RPC
 * calls. Since mock_env.ts provides a localhost RPC URL that does not exist,
 * the approve handler will fail with 500 "Failed to add provider on-chain".
 *
 * Run with: deno test --allow-all --no-check --config tests/deno.json tests/integration/api/council-join-requests.test.ts
 */
import { assertEquals } from "@std/assert";
import { createMockContext } from "../../test_app.ts";
import {
  ADMIN_KEYPAIR,
  ensureInitialized,
  JoinRequestStatus,
  resetDb,
  seedCouncilMetadata,
  seedJoinRequest,
} from "../../test_helpers.ts";

import {
  approveJoinRequestHandler,
  listJoinRequestsHandler,
  rejectJoinRequestHandler,
} from "@/http/v1/council/join-requests.ts";

const adminState = {
  session: {
    sub: ADMIN_KEYPAIR.publicKey(),
    type: "admin",
    exp: Math.floor(Date.now() / 1000) + 3600,
  },
};

// ---------------------------------------------------------------------------
// GET /council/provider-requests
// ---------------------------------------------------------------------------

Deno.test("GET /council/provider-requests - lists all join requests", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata();

  await seedJoinRequest({ status: JoinRequestStatus.PENDING });
  await seedJoinRequest({ status: JoinRequestStatus.APPROVED });
  await seedJoinRequest({ status: JoinRequestStatus.REJECTED });

  const { ctx, getResponse } = createMockContext({
    method: "GET",
    path: "/council/provider-requests",
    query: { councilId: "default" },
    state: { ...adminState },
  });
  await listJoinRequestsHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.data.length, 3);
});

Deno.test("GET /council/provider-requests?status=PENDING - filters pending", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata();

  await seedJoinRequest({ status: JoinRequestStatus.PENDING });
  await seedJoinRequest({ status: JoinRequestStatus.PENDING });
  await seedJoinRequest({ status: JoinRequestStatus.APPROVED });

  const { ctx, getResponse } = createMockContext({
    method: "GET",
    path: "/council/provider-requests",
    query: { status: "PENDING", councilId: "default" },
    state: { ...adminState },
  });
  await listJoinRequestsHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.data.length, 2);
  for (const r of res.body.data) {
    assertEquals(r.status, "PENDING");
  }
});

// ---------------------------------------------------------------------------
// POST /council/provider-requests/:id/reject
// ---------------------------------------------------------------------------

Deno.test("POST /council/provider-requests/:id/reject - rejects a pending request", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata();

  const request = await seedJoinRequest({ status: JoinRequestStatus.PENDING });

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    path: `/council/provider-requests/${request.id}/reject`,
    params: { id: request.id },
    state: { ...adminState },
  });
  await rejectJoinRequestHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.data.status, "REJECTED");
});

Deno.test("POST /council/provider-requests/:id/reject - returns 404 for non-existent", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    path: "/council/provider-requests/non-existent/reject",
    params: { id: "non-existent" },
    state: { ...adminState },
  });
  await rejectJoinRequestHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 404);
  assertEquals(res.body.message, "Join request not found");
});

Deno.test("POST /council/provider-requests/:id/reject - returns 409 for already reviewed", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata();

  const request = await seedJoinRequest({ status: JoinRequestStatus.APPROVED });

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    path: `/council/provider-requests/${request.id}/reject`,
    params: { id: request.id },
    state: { ...adminState },
  });
  await rejectJoinRequestHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 409);
});

// ---------------------------------------------------------------------------
// POST /council/provider-requests/:id/approve
// ---------------------------------------------------------------------------

Deno.test("POST /council/provider-requests/:id/approve - returns 404 for non-existent", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    path: "/council/provider-requests/non-existent/approve",
    params: { id: "non-existent" },
    state: { ...adminState },
  });
  await approveJoinRequestHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 404);
  assertEquals(res.body.message, "Join request not found");
});

Deno.test("POST /council/provider-requests/:id/approve - returns 409 for already reviewed", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata();

  const request = await seedJoinRequest({ status: JoinRequestStatus.REJECTED });

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    path: `/council/provider-requests/${request.id}/approve`,
    params: { id: request.id },
    state: { ...adminState },
  });
  await approveJoinRequestHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 409);
});

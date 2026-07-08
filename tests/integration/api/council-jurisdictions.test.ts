/**
 * Integration tests for council jurisdictions API routes.
 *
 * Run with: deno test --allow-all --no-check --config tests/deno.json tests/integration/api/council-jurisdictions.test.ts
 */
import { assertEquals, assertExists } from "@std/assert";
import { newNoop } from "@/utils/logger/index.ts";
import { createMockContext, runHandler } from "../../test_app.ts";
import {
  ADMIN_KEYPAIR,
  ensureInitialized,
  resetDb,
  seedCouncilMetadata,
  seedJurisdiction,
} from "../../test_helpers.ts";

import {
  handleAddJurisdiction,
  handleListJurisdictions,
  handleRemoveJurisdiction,
} from "@/http/v1/council/jurisdictions.ts";

const adminState = {
  session: {
    sub: ADMIN_KEYPAIR.publicKey(),
    type: "admin",
    exp: Math.floor(Date.now() / 1000) + 3600,
  },
};

// ---------------------------------------------------------------------------
// GET /council/jurisdictions
// ---------------------------------------------------------------------------

Deno.test("GET /council/jurisdictions - lists jurisdictions", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata();

  await seedJurisdiction({ countryCode: "US", label: "United States" });
  await seedJurisdiction({ countryCode: "GB", label: "United Kingdom" });

  const { ctx, getResponse } = createMockContext({
    method: "GET",
    query: { councilId: "default" },
    state: { ...adminState },
  });
  await runHandler(ctx, handleListJurisdictions({ log: newNoop() }));

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.data.length, 2);
});

// ---------------------------------------------------------------------------
// POST /council/jurisdictions
// ---------------------------------------------------------------------------

Deno.test("POST /council/jurisdictions - adds a jurisdiction", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { countryCode: "US", label: "United States" },
    query: { councilId: "default" },
    state: { ...adminState },
  });
  await runHandler(ctx, handleAddJurisdiction({ log: newNoop() }));

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.message, "Jurisdiction added");
  assertEquals(res.body.data.countryCode, "US");
  assertEquals(res.body.data.label, "United States");
  assertExists(res.body.data.id);
});

Deno.test("POST /council/jurisdictions - rejects invalid country code", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { countryCode: "INVALID" },
    query: { councilId: "default" },
    state: { ...adminState },
  });
  await runHandler(ctx, handleAddJurisdiction({ log: newNoop() }));

  const res = getResponse();
  assertEquals(res.status, 400);
  assertEquals(res.body.code, "HTTP_REQ_002");
});

Deno.test("POST /council/jurisdictions - rejects duplicate country code", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata();

  await seedJurisdiction({ countryCode: "US" });

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { countryCode: "US", label: "Duplicate" },
    query: { councilId: "default" },
    state: { ...adminState },
  });
  await runHandler(ctx, handleAddJurisdiction({ log: newNoop() }));

  const res = getResponse();
  assertEquals(res.status, 409);
  assertEquals(res.body.code, "HTTP_REQ_005");
});

// ---------------------------------------------------------------------------
// DELETE /council/jurisdictions/:code
// ---------------------------------------------------------------------------

Deno.test("DELETE /council/jurisdictions/:code - removes a jurisdiction", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata();

  await seedJurisdiction({ countryCode: "DE", label: "Germany" });

  const { ctx, getResponse } = createMockContext({
    method: "DELETE",
    params: { code: "DE" },
    query: { councilId: "default" },
    state: { ...adminState },
  });
  await runHandler(ctx, handleRemoveJurisdiction({ log: newNoop() }));

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.message, "Jurisdiction DE removed");
});

Deno.test("DELETE /council/jurisdictions/:code - returns 404 for non-existent", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata();

  const { ctx, getResponse } = createMockContext({
    method: "DELETE",
    params: { code: "ZZ" },
    query: { councilId: "default" },
    state: { ...adminState },
  });
  await runHandler(ctx, handleRemoveJurisdiction({ log: newNoop() }));

  const res = getResponse();
  assertEquals(res.status, 404);
  assertEquals(res.body.code, "HTTP_REQ_004");
  assertEquals(res.body.message, "Jurisdiction ZZ not found");
});

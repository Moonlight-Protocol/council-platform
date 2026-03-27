/**
 * Integration tests for council jurisdictions API routes.
 *
 * Run with: deno test --allow-all --no-check --config tests/deno.json tests/integration/api/council-jurisdictions.test.ts
 */
import { assertEquals, assertExists } from "@std/assert";
import { createMockContext } from "../../test_app.ts";
import { resetDb, ensureInitialized, seedJurisdiction, ADMIN_KEYPAIR } from "../../test_helpers.ts";

import {
  listJurisdictionsHandler,
  addJurisdictionHandler,
  removeJurisdictionHandler,
} from "@/http/v1/council/jurisdictions.ts";

const adminState = {
  session: { sub: ADMIN_KEYPAIR.publicKey(), type: "admin", exp: Math.floor(Date.now() / 1000) + 3600 },
};

// ---------------------------------------------------------------------------
// GET /council/jurisdictions
// ---------------------------------------------------------------------------

Deno.test("GET /council/jurisdictions - lists jurisdictions", async () => {
  await ensureInitialized();
  await resetDb();

  await seedJurisdiction({ countryCode: "US", label: "United States" });
  await seedJurisdiction({ countryCode: "GB", label: "United Kingdom" });

  const { ctx, getResponse } = createMockContext({ method: "GET", state: { ...adminState } });
  await listJurisdictionsHandler(ctx);

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

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { countryCode: "US", label: "United States" },
    state: { ...adminState },
  });
  await addJurisdictionHandler(ctx);

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

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { countryCode: "INVALID" },
    state: { ...adminState },
  });
  await addJurisdictionHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
});

Deno.test("POST /council/jurisdictions - rejects duplicate country code", async () => {
  await ensureInitialized();
  await resetDb();

  await seedJurisdiction({ countryCode: "US" });

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { countryCode: "US", label: "Duplicate" },
    state: { ...adminState },
  });
  await addJurisdictionHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 409);
});

// ---------------------------------------------------------------------------
// DELETE /council/jurisdictions/:code
// ---------------------------------------------------------------------------

Deno.test("DELETE /council/jurisdictions/:code - removes a jurisdiction", async () => {
  await ensureInitialized();
  await resetDb();

  await seedJurisdiction({ countryCode: "DE", label: "Germany" });

  const { ctx, getResponse } = createMockContext({
    method: "DELETE",
    params: { code: "DE" },
    state: { ...adminState },
  });
  await removeJurisdictionHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.message, "Jurisdiction DE removed");
});

Deno.test("DELETE /council/jurisdictions/:code - returns 404 for non-existent", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    method: "DELETE",
    params: { code: "ZZ" },
    state: { ...adminState },
  });
  await removeJurisdictionHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 404);
});

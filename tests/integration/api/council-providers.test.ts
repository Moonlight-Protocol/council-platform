/**
 * Integration tests for council providers API routes.
 *
 * Run with: deno test --allow-all --no-check --config tests/deno.json tests/integration/api/council-providers.test.ts
 */
import { assertEquals } from "@std/assert";
import { createMockContext } from "../../test_app.ts";
import { resetDb, ensureInitialized, seedProvider, seedCouncilMetadata, ADMIN_KEYPAIR, ProviderStatus } from "../../test_helpers.ts";
import { Keypair } from "stellar-sdk";

import {
  listProvidersHandler,
  getProviderHandler,
  updateProviderHandler,
} from "@/http/v1/council/providers.ts";

const adminState = {
  session: { sub: ADMIN_KEYPAIR.publicKey(), type: "admin", exp: Math.floor(Date.now() / 1000) + 3600 },
};

// ---------------------------------------------------------------------------
// GET /council/providers
// ---------------------------------------------------------------------------

Deno.test("GET /council/providers - lists all providers", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata();

  await seedProvider({ publicKey: Keypair.random().publicKey(), status: ProviderStatus.ACTIVE });
  await seedProvider({ publicKey: Keypair.random().publicKey(), status: ProviderStatus.REMOVED });

  const { ctx, getResponse } = createMockContext({
    method: "GET",
    path: "/council/providers",
    query: { councilId: "default" },
    state: { ...adminState },
  });
  await listProvidersHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.data.length, 2);
});

Deno.test("GET /council/providers?status=ACTIVE - filters to active", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata();

  await seedProvider({ publicKey: Keypair.random().publicKey(), status: ProviderStatus.ACTIVE });
  await seedProvider({ publicKey: Keypair.random().publicKey(), status: ProviderStatus.REMOVED });

  const { ctx, getResponse } = createMockContext({
    method: "GET",
    path: "/council/providers",
    query: { status: "ACTIVE", councilId: "default" },
    state: { ...adminState },
  });
  await listProvidersHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.data.length, 1);
  assertEquals(res.body.data[0].status, "ACTIVE");
});

// ---------------------------------------------------------------------------
// GET /council/providers/:id
// ---------------------------------------------------------------------------

Deno.test("GET /council/providers/:id - returns provider details", async () => {
  await ensureInitialized();
  await resetDb();

  const provider = await seedProvider({ label: "My Provider" });

  const { ctx, getResponse } = createMockContext({
    method: "GET",
    params: { id: provider.id },
    state: { ...adminState },
  });
  await getProviderHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.data.label, "My Provider");
});

Deno.test("GET /council/providers/:id - returns 404 for non-existent", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    method: "GET",
    params: { id: "non-existent" },
    state: { ...adminState },
  });
  await getProviderHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 404);
});

// ---------------------------------------------------------------------------
// PUT /council/providers/:id
// ---------------------------------------------------------------------------

Deno.test("PUT /council/providers/:id - updates provider metadata", async () => {
  await ensureInitialized();
  await resetDb();

  const provider = await seedProvider({ label: "Original" });

  const { ctx, getResponse } = createMockContext({
    method: "PUT",
    params: { id: provider.id },
    body: { label: "Updated Label", contactEmail: "new@example.com" },
    state: { ...adminState },
  });
  await updateProviderHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.data.label, "Updated Label");
  assertEquals(res.body.data.contactEmail, "new@example.com");
});

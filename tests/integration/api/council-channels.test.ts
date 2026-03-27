/**
 * Integration tests for council channels API routes.
 *
 * Run with: deno test --allow-all --no-check --config tests/deno.json tests/integration/api/council-channels.test.ts
 */
import { assertEquals, assertExists } from "@std/assert";
import { createMockContext } from "../../test_app.ts";
import { resetDb, ensureInitialized, seedChannel, ADMIN_KEYPAIR } from "../../test_helpers.ts";

import {
  listChannelsHandler,
  addChannelHandler,
  getChannelHandler,
  removeChannelHandler,
  enableChannelHandler,
  listDisabledChannelsHandler,
} from "@/http/v1/council/channels.ts";

const adminState = {
  session: { sub: ADMIN_KEYPAIR.publicKey(), type: "admin", exp: Math.floor(Date.now() / 1000) + 3600 },
};

const TEST_CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4";
const TEST_CONTRACT_ID_2 = "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBHK3M";

// ---------------------------------------------------------------------------
// GET /council/channels
// ---------------------------------------------------------------------------

Deno.test("GET /council/channels - lists channels", async () => {
  await ensureInitialized();
  await resetDb();

  await seedChannel({ channelContractId: TEST_CONTRACT_ID, assetCode: "XLM" });

  const { ctx, getResponse } = createMockContext({ method: "GET", state: { ...adminState } });
  await listChannelsHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.data.length, 1);
  assertEquals(res.body.data[0].assetCode, "XLM");
});

// ---------------------------------------------------------------------------
// POST /council/channels
// ---------------------------------------------------------------------------

Deno.test("POST /council/channels - adds a channel", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { channelContractId: TEST_CONTRACT_ID, assetCode: "XLM", label: "Test Channel" },
    state: { ...adminState },
  });
  await addChannelHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.message, "Channel added");
  assertEquals(res.body.data.channelContractId, TEST_CONTRACT_ID);
  assertEquals(res.body.data.assetCode, "XLM");
});

Deno.test("POST /council/channels - rejects invalid contract ID", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { channelContractId: "not-a-contract-id", assetCode: "XLM" },
    state: { ...adminState },
  });
  await addChannelHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
  assertEquals(res.body.message, "Invalid Soroban contract ID format");
});

Deno.test("POST /council/channels - rejects duplicate contract ID", async () => {
  await ensureInitialized();
  await resetDb();

  await seedChannel({ channelContractId: TEST_CONTRACT_ID });

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { channelContractId: TEST_CONTRACT_ID, assetCode: "XLM" },
    state: { ...adminState },
  });
  await addChannelHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 409);
});

Deno.test("POST /council/channels - rejects missing assetCode", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { channelContractId: TEST_CONTRACT_ID },
    state: { ...adminState },
  });
  await addChannelHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
  assertEquals(res.body.message, "assetCode is required");
});

// ---------------------------------------------------------------------------
// GET /council/channels/:id
// ---------------------------------------------------------------------------

Deno.test("GET /council/channels/:id - returns channel with state", async () => {
  await ensureInitialized();
  await resetDb();

  const channel = await seedChannel({ channelContractId: TEST_CONTRACT_ID });

  const { ctx, getResponse } = createMockContext({
    method: "GET",
    params: { id: channel.id },
    state: { ...adminState },
  });
  await getChannelHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
});

Deno.test("GET /council/channels/:id - returns 404 for non-existent", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    method: "GET",
    params: { id: "non-existent-id" },
    state: { ...adminState },
  });
  await getChannelHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 404);
});

// ---------------------------------------------------------------------------
// DELETE /council/channels/:id (disable)
// ---------------------------------------------------------------------------

Deno.test("DELETE /council/channels/:id - disables channel", async () => {
  await ensureInitialized();
  await resetDb();

  const channel = await seedChannel({ channelContractId: TEST_CONTRACT_ID });

  const { ctx, getResponse } = createMockContext({
    method: "DELETE",
    params: { id: channel.id },
    state: { ...adminState },
  });
  await removeChannelHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.message, "Channel disabled");
});

// ---------------------------------------------------------------------------
// POST /council/channels/:id/enable
// ---------------------------------------------------------------------------

Deno.test("POST /council/channels/:id/enable - re-enables disabled channel", async () => {
  await ensureInitialized();
  await resetDb();

  const channel = await seedChannel({ channelContractId: TEST_CONTRACT_ID });

  // First disable it
  const disableCtx = createMockContext({
    method: "DELETE",
    params: { id: channel.id },
    state: { ...adminState },
  });
  await removeChannelHandler(disableCtx.ctx);

  // Then re-enable
  const { ctx, getResponse } = createMockContext({
    method: "POST",
    params: { id: channel.id },
    state: { ...adminState },
  });
  await enableChannelHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.message, "Channel re-enabled");
});

// ---------------------------------------------------------------------------
// GET /council/channels/disabled
// ---------------------------------------------------------------------------

Deno.test("GET /council/channels/disabled - lists disabled channels", async () => {
  await ensureInitialized();
  await resetDb();

  const ch = await seedChannel({ channelContractId: TEST_CONTRACT_ID });
  await seedChannel({ channelContractId: TEST_CONTRACT_ID_2 });

  // Disable one
  const disableCtx = createMockContext({
    method: "DELETE",
    params: { id: ch.id },
    state: { ...adminState },
  });
  await removeChannelHandler(disableCtx.ctx);

  const { ctx, getResponse } = createMockContext({
    method: "GET",
    state: { ...adminState },
  });
  await listDisabledChannelsHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.data.length, 1);
  assertEquals(res.body.data[0].channelContractId, TEST_CONTRACT_ID);
});

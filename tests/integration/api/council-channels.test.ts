/**
 * Integration tests for council channels API routes.
 *
 * Run with: deno test --allow-all --no-check --config tests/deno.json tests/integration/api/council-channels.test.ts
 */
import { assertEquals } from "@std/assert";
import { newNoop } from "@/utils/logger/index.ts";
import { createMockContext } from "../../test_app.ts";
import {
  ADMIN_KEYPAIR,
  drizzleClient,
  ensureInitialized,
  resetDb,
  seedChannel,
  seedCouncilMetadata,
} from "../../test_helpers.ts";
import { CouncilChannelRepository } from "@/persistence/drizzle/repository/council-channel.repository.ts";

import {
  handleAddChannel,
  handleEnableChannel,
  handleGetChannel,
  handleListChannels,
  handleListDisabledChannels,
  handleRemoveChannel,
} from "@/http/v1/council/channels.ts";

// Simulates the event-watcher confirming an on-chain ChannelStateChanged event —
// the ONLY path that flips authoritative status. HTTP endpoints set pending only.
const channelRepo = new CouncilChannelRepository(drizzleClient);
function confirmOnChain(contractId: string, enabled: boolean) {
  return channelRepo.setStatusByContractId(
    "default",
    contractId,
    enabled ? "enabled" : "disabled",
  );
}

const adminState = {
  session: {
    sub: ADMIN_KEYPAIR.publicKey(),
    type: "admin",
    exp: Math.floor(Date.now() / 1000) + 3600,
  },
};

const TEST_CONTRACT_ID =
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4";
const TEST_CONTRACT_ID_2 =
  "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBHK3M";

// ---------------------------------------------------------------------------
// GET /council/channels
// ---------------------------------------------------------------------------

Deno.test("GET /council/channels - lists channels", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata();

  await seedChannel({ channelContractId: TEST_CONTRACT_ID, assetCode: "XLM" });

  const { ctx, getResponse } = createMockContext({
    method: "GET",
    query: { councilId: "default" },
    state: { ...adminState },
  });
  await handleListChannels({ log: newNoop() })(ctx);

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
  await seedCouncilMetadata();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: {
      channelContractId: TEST_CONTRACT_ID,
      assetCode: "XLM",
      label: "Test Channel",
    },
    query: { councilId: "default" },
    state: { ...adminState },
  });
  await handleAddChannel({ log: newNoop() })(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.message, "Channel added");
  assertEquals(res.body.data.channelContractId, TEST_CONTRACT_ID);
  assertEquals(res.body.data.assetCode, "XLM");
});

Deno.test("POST /council/channels - rejects invalid contract ID", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { channelContractId: "not-a-contract-id", assetCode: "XLM" },
    query: { councilId: "default" },
    state: { ...adminState },
  });
  await handleAddChannel({ log: newNoop() })(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
  assertEquals(res.body.message, "Invalid Soroban contract ID format");
});

Deno.test("POST /council/channels - rejects duplicate contract ID", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata();

  await seedChannel({ channelContractId: TEST_CONTRACT_ID });

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { channelContractId: TEST_CONTRACT_ID, assetCode: "XLM" },
    query: { councilId: "default" },
    state: { ...adminState },
  });
  await handleAddChannel({ log: newNoop() })(ctx);

  const res = getResponse();
  assertEquals(res.status, 409);
});

Deno.test("POST /council/channels - rejects missing assetCode", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { channelContractId: TEST_CONTRACT_ID },
    query: { councilId: "default" },
    state: { ...adminState },
  });
  await handleAddChannel({ log: newNoop() })(ctx);

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
  await seedCouncilMetadata();

  const channel = await seedChannel({ channelContractId: TEST_CONTRACT_ID });

  const { ctx, getResponse } = createMockContext({
    method: "GET",
    params: { id: channel.id },
    state: { ...adminState },
  });
  await handleGetChannel({ log: newNoop() })(ctx);

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
  await handleGetChannel({ log: newNoop() })(ctx);

  const res = getResponse();
  assertEquals(res.status, 404);
});

// ---------------------------------------------------------------------------
// DELETE /council/channels/:id (disable)
// ---------------------------------------------------------------------------

Deno.test("DELETE /council/channels/:id - requests disable (pending, not authoritative)", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata();

  const channel = await seedChannel({ channelContractId: TEST_CONTRACT_ID });

  const { ctx, getResponse } = createMockContext({
    method: "DELETE",
    params: { id: channel.id },
    state: { ...adminState },
  });
  await handleRemoveChannel({ log: newNoop() })(ctx);

  const res = getResponse();
  // 202: intent recorded, awaiting on-chain confirmation. The endpoint sets the
  // optimistic marker but must NOT flip authoritative status.
  assertEquals(res.status, 202);
  assertEquals(res.body.data.pendingAction, "disable");
  assertEquals(res.body.data.status, "enabled");

  // DB confirms status is untouched until the watcher confirms the chain.
  const stored = await channelRepo.findById(channel.id);
  assertEquals(stored?.status, "enabled");
  assertEquals(stored?.pendingAction, "disable");
});

// ---------------------------------------------------------------------------
// POST /council/channels/:id/enable
// ---------------------------------------------------------------------------

Deno.test("POST /council/channels/:id/enable - re-enables disabled channel", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata();

  const channel = await seedChannel({ channelContractId: TEST_CONTRACT_ID });

  // Disable request + simulated on-chain confirmation (the watcher's write).
  const disableCtx = createMockContext({
    method: "DELETE",
    params: { id: channel.id },
    state: { ...adminState },
  });
  await handleRemoveChannel({ log: newNoop() })(disableCtx.ctx);
  await confirmOnChain(channel.channelContractId, false);

  // Then re-enable — endpoint records intent for the now-disabled channel.
  const { ctx, getResponse } = createMockContext({
    method: "POST",
    params: { id: channel.id },
    state: { ...adminState },
  });
  await handleEnableChannel({ log: newNoop() })(ctx);

  const res = getResponse();
  assertEquals(res.status, 202);
  assertEquals(res.body.data.pendingAction, "enable");
  // Authoritative status is still disabled until the chain confirms re-enable.
  assertEquals(res.body.data.status, "disabled");
});

// ---------------------------------------------------------------------------
// GET /council/channels/disabled
// ---------------------------------------------------------------------------

Deno.test("GET /council/channels/disabled - lists disabled channels", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata();

  const ch = await seedChannel({ channelContractId: TEST_CONTRACT_ID });
  await seedChannel({ channelContractId: TEST_CONTRACT_ID_2 });

  // Disable one and confirm it on-chain (the watcher's authoritative write).
  const disableCtx = createMockContext({
    method: "DELETE",
    params: { id: ch.id },
    state: { ...adminState },
  });
  await handleRemoveChannel({ log: newNoop() })(disableCtx.ctx);
  await confirmOnChain(ch.channelContractId, false);

  const { ctx, getResponse } = createMockContext({
    method: "GET",
    query: { councilId: "default" },
    state: { ...adminState },
  });
  await handleListDisabledChannels({ log: newNoop() })(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.data.length, 1);
  assertEquals(res.body.data[0].channelContractId, TEST_CONTRACT_ID);
  assertEquals(res.body.data[0].status, "disabled");
});

// ---------------------------------------------------------------------------
// POST /council/channels - additional validation
// ---------------------------------------------------------------------------

Deno.test("POST /council/channels - rejects assetCode over 12 chars", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: {
      channelContractId: TEST_CONTRACT_ID,
      assetCode: "TOOLONGASSETCODE",
    },
    query: { councilId: "default" },
    state: { ...adminState },
  });
  await handleAddChannel({ log: newNoop() })(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
  assertEquals(
    res.body.message,
    "assetCode must be 1-12 alphanumeric characters",
  );
});

Deno.test("POST /council/channels - rejects assetCode with special characters", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { channelContractId: TEST_CONTRACT_ID, assetCode: "USD$" },
    query: { councilId: "default" },
    state: { ...adminState },
  });
  await handleAddChannel({ log: newNoop() })(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
  assertEquals(
    res.body.message,
    "assetCode must be 1-12 alphanumeric characters",
  );
});

Deno.test("POST /council/channels - rejects label over 200 chars", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: {
      channelContractId: TEST_CONTRACT_ID,
      assetCode: "XLM",
      label: "x".repeat(201),
    },
    query: { councilId: "default" },
    state: { ...adminState },
  });
  await handleAddChannel({ log: newNoop() })(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
  assertEquals(res.body.message, "label must be at most 200 characters");
});

Deno.test("POST /council/channels - rejects malformed JSON", async () => {
  await ensureInitialized();
  await resetDb();
  await seedCouncilMetadata();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: undefined,
    query: { councilId: "default" },
    state: { ...adminState },
  });
  await handleAddChannel({ log: newNoop() })(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
  assertEquals(res.body.message, "Invalid request body");
});

// ---------------------------------------------------------------------------
// POST /council/channels/:id/enable - additional cases
// ---------------------------------------------------------------------------

Deno.test("POST /council/channels/:id/enable - returns 404 for active channel", async () => {
  await ensureInitialized();
  await resetDb();

  const channel = await seedChannel({ channelContractId: TEST_CONTRACT_ID });

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    params: { id: channel.id },
    state: { ...adminState },
  });
  await handleEnableChannel({ log: newNoop() })(ctx);

  const res = getResponse();
  assertEquals(res.status, 404);
  assertEquals(res.body.message, "Disabled channel not found");
});

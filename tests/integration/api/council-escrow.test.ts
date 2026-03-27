/**
 * Integration tests for council escrow API routes.
 *
 * Tests escrow creation, summary, recipient UTXO lookup, and release.
 *
 * Run with: deno test --allow-all --no-check --config tests/deno.json tests/integration/api/council-escrow.test.ts
 */
import { assertEquals, assertExists } from "@std/assert";
import { createMockContext } from "../../test_app.ts";
import {
  resetDb,
  ensureInitialized,
  seedProvider,
  seedCustodialUser,
  seedEscrow,
  testAddress,
  testContractId,
  ADMIN_KEYPAIR,
  ProviderStatus,
  EscrowStatus,
} from "../../test_helpers.ts";
import { Keypair } from "stellar-sdk";

import {
  getRecipientUtxosHandler,
  postEscrowHandler,
  getEscrowSummaryHandler,
  postEscrowReleaseHandler,
} from "@/http/v1/council/escrow.ts";

const TEST_CONTRACT_ID = testContractId();

function providerState(publicKey: string) {
  return {
    session: {
      sub: publicKey,
      type: "provider",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
  };
}

function adminState() {
  return {
    session: {
      sub: ADMIN_KEYPAIR.publicKey(),
      type: "admin",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
  };
}

// ---------------------------------------------------------------------------
// POST /council/escrow
// ---------------------------------------------------------------------------

Deno.test("POST /council/escrow - creates escrow with provider JWT", async () => {
  await ensureInitialized();
  await resetDb();

  const providerKp = Keypair.random();
  await seedProvider({ publicKey: providerKp.publicKey(), status: ProviderStatus.ACTIVE });

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: {
      senderAddress: testAddress(),
      recipientAddress: testAddress(),
      amount: "1000000",
      assetCode: "XLM",
      channelContractId: TEST_CONTRACT_ID,
    },
    state: providerState(providerKp.publicKey()),
  });
  await postEscrowHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.message, "Escrow created");
  assertExists(res.body.data.escrowId);
});

Deno.test("POST /council/escrow - rejects non-provider JWT", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: {
      senderAddress: testAddress(),
      recipientAddress: testAddress(),
      amount: "1000000",
      assetCode: "XLM",
      channelContractId: TEST_CONTRACT_ID,
    },
    state: adminState(),
  });
  await postEscrowHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 403);
  assertEquals(res.body.message, "Provider access required");
});

Deno.test("POST /council/escrow - rejects invalid amount", async () => {
  await ensureInitialized();
  await resetDb();

  const providerKp = Keypair.random();
  await seedProvider({ publicKey: providerKp.publicKey(), status: ProviderStatus.ACTIVE });

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: {
      senderAddress: testAddress(),
      recipientAddress: testAddress(),
      amount: "not-a-number",
      assetCode: "XLM",
      channelContractId: TEST_CONTRACT_ID,
    },
    state: providerState(providerKp.publicKey()),
  });
  await postEscrowHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
  assertEquals(res.body.message, "amount must be a positive integer string (stroops)");
});

Deno.test("POST /council/escrow - rejects missing fields", async () => {
  await ensureInitialized();
  await resetDb();

  const providerKp = Keypair.random();
  await seedProvider({ publicKey: providerKp.publicKey(), status: ProviderStatus.ACTIVE });

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: {
      senderAddress: testAddress(),
      // recipientAddress missing
      amount: "1000",
      assetCode: "XLM",
      channelContractId: TEST_CONTRACT_ID,
    },
    state: providerState(providerKp.publicKey()),
  });
  await postEscrowHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
});

// ---------------------------------------------------------------------------
// GET /council/escrow/:address
// ---------------------------------------------------------------------------

Deno.test("GET /council/escrow/:address - returns escrow summary", async () => {
  await ensureInitialized();
  await resetDb();

  const recipientAddr = testAddress();

  await seedEscrow({
    recipientAddress: recipientAddr,
    amount: 5000n,
    status: EscrowStatus.HELD,
  });
  await seedEscrow({
    recipientAddress: recipientAddr,
    amount: 3000n,
    status: EscrowStatus.HELD,
  });

  const { ctx, getResponse } = createMockContext({
    method: "GET",
    path: `/council/escrow/${recipientAddr}`,
    params: { address: recipientAddr },
    state: adminState(),
  });
  await getEscrowSummaryHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.message, "Escrow summary retrieved");
  assertEquals(res.body.data.pendingCount, 2);
  assertEquals(res.body.data.pendingTotal, "8000");
  assertEquals(res.body.data.escrows.length, 2);
});

// ---------------------------------------------------------------------------
// GET /council/recipient/:address/utxos
// ---------------------------------------------------------------------------

Deno.test("GET /council/recipient/:address/utxos - returns registered=false for unknown user", async () => {
  await ensureInitialized();
  await resetDb();

  const unknownAddr = testAddress();

  const { ctx, getResponse } = createMockContext({
    method: "GET",
    path: `/council/recipient/${unknownAddr}/utxos`,
    params: { address: unknownAddr },
    query: { channelContractId: TEST_CONTRACT_ID, count: "1" },
  });
  await getRecipientUtxosHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.data.registered, false);
  assertEquals(res.body.data.publicKeys.length, 0);
});

Deno.test("GET /council/recipient/:address/utxos - returns registered=true for registered user", async () => {
  await ensureInitialized();
  await resetDb();

  const userAddr = "user-utxo-test";
  await seedCustodialUser({
    externalId: userAddr,
    channelContractId: TEST_CONTRACT_ID,
  });

  const { ctx, getResponse } = createMockContext({
    method: "GET",
    path: `/council/recipient/${userAddr}/utxos`,
    params: { address: userAddr },
    query: { channelContractId: TEST_CONTRACT_ID, count: "2" },
  });
  await getRecipientUtxosHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.data.registered, true);
  assertEquals(res.body.data.publicKeys.length, 2);
});

// ---------------------------------------------------------------------------
// POST /council/escrow/:address/release
// ---------------------------------------------------------------------------

Deno.test("POST /council/escrow/:address/release - releases held escrows", async () => {
  await ensureInitialized();
  await resetDb();

  const recipientAddr = "user-release-test";

  // Seed a registered custodial user
  await seedCustodialUser({
    externalId: recipientAddr,
    channelContractId: TEST_CONTRACT_ID,
  });

  // Seed held escrows for that user
  await seedEscrow({
    recipientAddress: recipientAddr,
    amount: 5000000n,
    channelContractId: TEST_CONTRACT_ID,
    status: EscrowStatus.HELD,
  });
  await seedEscrow({
    recipientAddress: recipientAddr,
    amount: 3000000n,
    channelContractId: TEST_CONTRACT_ID,
    status: EscrowStatus.HELD,
  });

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    path: `/council/escrow/${recipientAddr}/release`,
    params: { address: recipientAddr },
    body: { channelContractId: TEST_CONTRACT_ID },
    state: adminState(),
  });
  await postEscrowReleaseHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.data.released, 2);
  // totalReleased should be (5000000 - 1000000) + (3000000 - 1000000) = 6000000
  assertEquals(res.body.data.totalReleased, "6000000");
  // totalFees should be 2 * 1000000 = 2000000
  assertEquals(res.body.data.totalFees, "2000000");
});

Deno.test("POST /council/escrow - rejects invalid channelContractId", async () => {
  await ensureInitialized();
  await resetDb();

  const providerKp = Keypair.random();
  await seedProvider({ publicKey: providerKp.publicKey(), status: ProviderStatus.ACTIVE });

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: {
      senderAddress: testAddress(),
      recipientAddress: testAddress(),
      amount: "1000000",
      assetCode: "XLM",
      channelContractId: "not-a-contract-id",
    },
    state: providerState(providerKp.publicKey()),
  });
  await postEscrowHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
  assertEquals(res.body.message, "Invalid channelContractId");
});

Deno.test("POST /council/escrow/:address/release - rejects invalid channelContractId", async () => {
  await ensureInitialized();
  await resetDb();

  const recipientAddr = "user-release-bad-contract";

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    path: `/council/escrow/${recipientAddr}/release`,
    params: { address: recipientAddr },
    body: { channelContractId: "bad" },
    state: adminState(),
  });
  await postEscrowReleaseHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
  assertEquals(res.body.message, "Valid channelContractId is required");
});

/**
 * Integration tests for council sign API routes.
 *
 * Tests the custodial signing handlers: register, keys, spend.
 *
 * Run with: deno test --allow-all --no-check --config tests/deno.json tests/integration/api/council-sign.test.ts
 */
import { assertEquals, assertExists } from "@std/assert";
import { createMockContext } from "../../test_app.ts";
import {
  resetDb,
  ensureInitialized,
  seedProvider,
  seedCustodialUser,
  testContractId,
  ProviderStatus,
  CustodialUserStatus,
} from "../../test_helpers.ts";
import { Keypair } from "stellar-sdk";

import {
  postRegisterUserHandler,
  postGetKeysHandler,
  postSignSpendHandler,
} from "@/http/v1/council/sign.ts";

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

function adminState(publicKey: string) {
  return {
    session: {
      sub: publicKey,
      type: "admin",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
  };
}

// ---------------------------------------------------------------------------
// POST /council/sign/register
// ---------------------------------------------------------------------------

Deno.test("POST /council/sign/register - creates user with provider JWT", async () => {
  await ensureInitialized();
  await resetDb();

  const providerKp = Keypair.random();
  await seedProvider({ publicKey: providerKp.publicKey(), status: ProviderStatus.ACTIVE });

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { externalId: "user-001", channelContractId: TEST_CONTRACT_ID },
    state: providerState(providerKp.publicKey()),
  });
  await postRegisterUserHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertExists(res.body.data.userId);
  assertExists(res.body.data.p256PublicKeyHex);
  assertEquals(typeof res.body.data.p256PublicKeyHex, "string");
  assertEquals(res.body.data.p256PublicKeyHex.length > 0, true);
});

Deno.test("POST /council/sign/register - rejects non-provider JWT", async () => {
  await ensureInitialized();
  await resetDb();

  const kp = Keypair.random();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { externalId: "user-001", channelContractId: TEST_CONTRACT_ID },
    state: adminState(kp.publicKey()),
  });
  await postRegisterUserHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 403);
});

Deno.test("POST /council/sign/register - returns same data for duplicate registration", async () => {
  await ensureInitialized();
  await resetDb();

  const providerKp = Keypair.random();
  await seedProvider({ publicKey: providerKp.publicKey(), status: ProviderStatus.ACTIVE });
  const state = providerState(providerKp.publicKey());
  const body = { externalId: "user-dup", channelContractId: TEST_CONTRACT_ID };

  // First registration
  const first = createMockContext({ method: "POST", body, state });
  await postRegisterUserHandler(first.ctx);
  const res1 = first.getResponse();
  assertEquals(res1.status, 200);

  // Second registration (duplicate)
  const second = createMockContext({ method: "POST", body, state });
  await postRegisterUserHandler(second.ctx);
  const res2 = second.getResponse();
  assertEquals(res2.status, 200);

  assertEquals(res1.body.data.userId, res2.body.data.userId);
  assertEquals(res1.body.data.p256PublicKeyHex, res2.body.data.p256PublicKeyHex);
});

Deno.test("POST /council/sign/register - rejects missing externalId", async () => {
  await ensureInitialized();
  await resetDb();

  const providerKp = Keypair.random();
  await seedProvider({ publicKey: providerKp.publicKey(), status: ProviderStatus.ACTIVE });

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { channelContractId: TEST_CONTRACT_ID },
    state: providerState(providerKp.publicKey()),
  });
  await postRegisterUserHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
  assertEquals(res.body.message, "externalId is required");
});

// ---------------------------------------------------------------------------
// POST /council/sign/keys
// ---------------------------------------------------------------------------

Deno.test("POST /council/sign/keys - returns derived public keys", async () => {
  await ensureInitialized();
  await resetDb();

  const providerKp = Keypair.random();
  await seedProvider({ publicKey: providerKp.publicKey(), status: ProviderStatus.ACTIVE });
  const state = providerState(providerKp.publicKey());

  // Register user first
  const regCtx = createMockContext({
    method: "POST",
    body: { externalId: "user-keys", channelContractId: TEST_CONTRACT_ID },
    state,
  });
  await postRegisterUserHandler(regCtx.ctx);
  assertEquals(regCtx.getResponse().status, 200);

  // Request keys at indices [0, 1, 2]
  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: {
      externalId: "user-keys",
      channelContractId: TEST_CONTRACT_ID,
      indices: [0, 1, 2],
    },
    state,
  });
  await postGetKeysHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.data.publicKeys.length, 3);
  // Each key should be a hex string (uncompressed P256 = 65 bytes = 130 hex chars)
  for (const pk of res.body.data.publicKeys) {
    assertEquals(typeof pk, "string");
    assertEquals(pk.length, 130);
  }
});

Deno.test("POST /council/sign/keys - rejects unregistered user", async () => {
  await ensureInitialized();
  await resetDb();

  const providerKp = Keypair.random();
  await seedProvider({ publicKey: providerKp.publicKey(), status: ProviderStatus.ACTIVE });

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: {
      externalId: "nonexistent-user",
      channelContractId: TEST_CONTRACT_ID,
      indices: [0],
    },
    state: providerState(providerKp.publicKey()),
  });
  await postGetKeysHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
});

Deno.test("POST /council/sign/keys - rejects more than 300 indices", async () => {
  await ensureInitialized();
  await resetDb();

  const providerKp = Keypair.random();
  await seedProvider({ publicKey: providerKp.publicKey(), status: ProviderStatus.ACTIVE });

  const indices = Array.from({ length: 301 }, (_, i) => i);

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: {
      externalId: "user-x",
      channelContractId: TEST_CONTRACT_ID,
      indices,
    },
    state: providerState(providerKp.publicKey()),
  });
  await postGetKeysHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
  assertEquals(res.body.message, "Maximum 300 indices per request");
});

// ---------------------------------------------------------------------------
// POST /council/sign/spend
// ---------------------------------------------------------------------------

Deno.test("POST /council/sign/spend - returns signatures for valid request", async () => {
  await ensureInitialized();
  await resetDb();

  const providerKp = Keypair.random();
  await seedProvider({ publicKey: providerKp.publicKey(), status: ProviderStatus.ACTIVE });
  const state = providerState(providerKp.publicKey());

  // Register user first
  const regCtx = createMockContext({
    method: "POST",
    body: { externalId: "user-spend", channelContractId: TEST_CONTRACT_ID },
    state,
  });
  await postRegisterUserHandler(regCtx.ctx);
  assertEquals(regCtx.getResponse().status, 200);

  // Sign a spend
  const messageHex = "deadbeef01020304deadbeef01020304deadbeef01020304deadbeef01020304";
  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: {
      channelContractId: TEST_CONTRACT_ID,
      spends: [
        { externalId: "user-spend", utxoIndex: 0, message: messageHex },
      ],
    },
    state,
  });
  await postSignSpendHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.data.signatures.length, 1);
  // Signature should be a hex-encoded DER signature
  assertEquals(typeof res.body.data.signatures[0], "string");
  assertEquals(res.body.data.signatures[0].length > 0, true);
});

Deno.test("POST /council/sign/spend - rejects non-provider JWT", async () => {
  await ensureInitialized();
  await resetDb();

  const kp = Keypair.random();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: {
      channelContractId: TEST_CONTRACT_ID,
      spends: [
        { externalId: "user-x", utxoIndex: 0, message: "aabb" },
      ],
    },
    state: adminState(kp.publicKey()),
  });
  await postSignSpendHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 403);
});

Deno.test("POST /council/sign/spend - rejects unregistered user", async () => {
  await ensureInitialized();
  await resetDb();

  const providerKp = Keypair.random();
  await seedProvider({ publicKey: providerKp.publicKey(), status: ProviderStatus.ACTIVE });

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: {
      channelContractId: TEST_CONTRACT_ID,
      spends: [
        { externalId: "nonexistent-user", utxoIndex: 0, message: "aabb" },
      ],
    },
    state: providerState(providerKp.publicKey()),
  });
  await postSignSpendHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 404);
  assertEquals(res.body.message, "User not registered for this channel");
});

Deno.test("POST /council/sign/spend - rejects wrong provider for user", async () => {
  await ensureInitialized();
  await resetDb();

  const providerAKp = Keypair.random();
  const providerBKp = Keypair.random();
  await seedProvider({ publicKey: providerAKp.publicKey(), status: ProviderStatus.ACTIVE });
  await seedProvider({ publicKey: providerBKp.publicKey(), status: ProviderStatus.ACTIVE });

  // Seed a custodial user registered by provider A
  await seedCustodialUser({
    externalId: "user-wrong-provider",
    channelContractId: TEST_CONTRACT_ID,
    registeredByProvider: providerAKp.publicKey(),
  });

  // Try to sign with provider B's session
  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: {
      channelContractId: TEST_CONTRACT_ID,
      spends: [
        { externalId: "user-wrong-provider", utxoIndex: 0, message: "aabb" },
      ],
    },
    state: providerState(providerBKp.publicKey()),
  });
  await postSignSpendHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 403);
  assertEquals(res.body.message, "Not authorized to sign for this user");
});

Deno.test("POST /council/sign/spend - rejects suspended user", async () => {
  await ensureInitialized();
  await resetDb();

  const providerKp = Keypair.random();
  await seedProvider({ publicKey: providerKp.publicKey(), status: ProviderStatus.ACTIVE });

  // Seed a suspended custodial user
  await seedCustodialUser({
    externalId: "user-suspended",
    channelContractId: TEST_CONTRACT_ID,
    status: CustodialUserStatus.SUSPENDED,
  });

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: {
      channelContractId: TEST_CONTRACT_ID,
      spends: [
        { externalId: "user-suspended", utxoIndex: 0, message: "aabb" },
      ],
    },
    state: providerState(providerKp.publicKey()),
  });
  await postSignSpendHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 403);
  assertEquals(res.body.message, "User is suspended");
});

Deno.test("POST /council/sign/spend - rejects invalid hex message", async () => {
  await ensureInitialized();
  await resetDb();

  const providerKp = Keypair.random();
  await seedProvider({ publicKey: providerKp.publicKey(), status: ProviderStatus.ACTIVE });

  // Seed an active custodial user
  await seedCustodialUser({
    externalId: "user-bad-hex",
    channelContractId: TEST_CONTRACT_ID,
  });

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: {
      channelContractId: TEST_CONTRACT_ID,
      spends: [
        { externalId: "user-bad-hex", utxoIndex: 0, message: "not-valid-hex" },
      ],
    },
    state: providerState(providerKp.publicKey()),
  });
  await postSignSpendHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
  assertEquals(res.body.message, "message must be a valid hex string with even length");
});

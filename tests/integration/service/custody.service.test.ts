/**
 * Integration tests for the custody service.
 *
 * Run with: deno test --allow-all --no-check --config tests/deno.json tests/integration/service/custody.service.test.ts
 */
import { assertEquals, assertExists, assertRejects } from "@std/assert";
import {
  ensureInitialized,
  resetDb,
  seedCustodialUser,
  testContractId,
  CustodialUserStatus,
} from "../../test_helpers.ts";
import { Keypair } from "stellar-sdk";
import {
  registerCustodialUser,
  getUserPublicKeys,
} from "@/core/service/custody/custody.service.ts";

const CONTRACT_ID = testContractId();

// ── registerCustodialUser ────────────────────────────────────────────────

Deno.test("registerCustodialUser - creates user and returns derived key", async () => {
  await ensureInitialized();
  await resetDb();

  const externalId = Keypair.random().publicKey();
  const result = await registerCustodialUser({
    councilId: "default",
    externalId,
    channelContractId: CONTRACT_ID,
  });

  assertExists(result.userId);
  assertExists(result.p256PublicKeyHex);
  assertEquals(result.p256PublicKeyHex.startsWith("04"), true);
});

Deno.test("registerCustodialUser - returns existing user for duplicate registration", async () => {
  await ensureInitialized();
  await resetDb();

  const externalId = Keypair.random().publicKey();
  const first = await registerCustodialUser({
    councilId: "default",
    externalId,
    channelContractId: CONTRACT_ID,
  });

  const second = await registerCustodialUser({
    councilId: "default",
    externalId,
    channelContractId: CONTRACT_ID,
  });

  assertEquals(first.userId, second.userId);
  assertEquals(first.p256PublicKeyHex, second.p256PublicKeyHex);
});

// ── getUserPublicKeys ────────────────────────────────────────────────────

Deno.test("getUserPublicKeys - returns derived keys at specified indices", async () => {
  await ensureInitialized();
  await resetDb();

  const externalId = Keypair.random().publicKey();
  await registerCustodialUser({
    councilId: "default",
    externalId,
    channelContractId: CONTRACT_ID,
  });

  const keys = await getUserPublicKeys(externalId, CONTRACT_ID, [0, 1, 2]);
  assertEquals(keys.length, 3);

  for (const key of keys) {
    assertEquals(key.startsWith("04"), true);
  }
});

Deno.test("getUserPublicKeys - returns consistent keys for same inputs", async () => {
  await ensureInitialized();
  await resetDb();

  const externalId = Keypair.random().publicKey();
  await registerCustodialUser({
    councilId: "default",
    externalId,
    channelContractId: CONTRACT_ID,
  });

  const first = await getUserPublicKeys(externalId, CONTRACT_ID, [0, 5, 10]);
  const second = await getUserPublicKeys(externalId, CONTRACT_ID, [0, 5, 10]);

  assertEquals(first, second);
});

Deno.test("getUserPublicKeys - returns different keys for different indices", async () => {
  await ensureInitialized();
  await resetDb();

  const externalId = Keypair.random().publicKey();
  await registerCustodialUser({
    councilId: "default",
    externalId,
    channelContractId: CONTRACT_ID,
  });

  const keys = await getUserPublicKeys(externalId, CONTRACT_ID, [0, 1]);
  assertEquals(keys.length, 2);
  // Keys at different indices must differ
  assertEquals(keys[0] !== keys[1], true);
});

Deno.test("getUserPublicKeys - throws for unregistered user", async () => {
  await ensureInitialized();
  await resetDb();

  await assertRejects(
    () => getUserPublicKeys("nonexistent-user", CONTRACT_ID, [0]),
    Error,
    "User not registered for this channel",
  );
});

Deno.test("getUserPublicKeys - throws for suspended user", async () => {
  await ensureInitialized();
  await resetDb();

  const externalId = `user-${crypto.randomUUID().slice(0, 8)}`;
  await seedCustodialUser({
    externalId,
    channelContractId: CONTRACT_ID,
    status: CustodialUserStatus.SUSPENDED,
  });

  await assertRejects(
    () => getUserPublicKeys(externalId, CONTRACT_ID, [0]),
    Error,
    "User account is suspended",
  );
});

Deno.test("getUserPublicKeys - throws for out-of-range indices", async () => {
  await ensureInitialized();
  await resetDb();

  const externalId = Keypair.random().publicKey();
  await registerCustodialUser({
    councilId: "default",
    externalId,
    channelContractId: CONTRACT_ID,
  });

  await assertRejects(
    () => getUserPublicKeys(externalId, CONTRACT_ID, [300]),
    Error,
    "out of range",
  );

  await assertRejects(
    () => getUserPublicKeys(externalId, CONTRACT_ID, [-1]),
    Error,
    "out of range",
  );
});

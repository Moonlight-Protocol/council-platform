/**
 * Integration tests for escrow service.
 *
 * Run with: deno test --allow-all --no-check --config tests/deno.json tests/integration/service/escrow.service.test.ts
 */
import { assertEquals, assertExists, assertRejects } from "@std/assert";
import {
  CustodialUserStatus,
  ensureInitialized,
  EscrowStatus,
  getAllEscrows,
  resetDb,
  seedCouncilWithRoot,
  seedCustodialUser,
  seedEscrow,
  testAddress,
  testContractId,
} from "../../test_helpers.ts";
import { Keypair } from "stellar-sdk";
import {
  createEscrow,
  getEscrowSummary,
  getRecipientUtxos,
  releaseEscrowsForRecipient,
} from "@/core/service/escrow/escrow.service.ts";

const DEFAULT_ESCROW_FEE = 1_000_000n;
const COUNCIL_ID = "default";

async function setupCouncil() {
  await ensureInitialized();
  await resetDb();
  await seedCouncilWithRoot({ id: COUNCIL_ID });
}

// ── createEscrow ─────────────────────────────────────────────────────────

Deno.test("createEscrow - creates a HELD escrow record", async () => {
  await ensureInitialized();
  await resetDb();

  const sender = testAddress();
  const recipient = testAddress();
  const channelId = testContractId();
  const provider = Keypair.random().publicKey();

  const { escrowId } = await createEscrow({
    councilId: "default",
    senderAddress: sender,
    recipientAddress: recipient,
    amount: 10_000_000n,
    assetCode: "XLM",
    channelContractId: channelId,
    submittedByProvider: provider,
  });

  assertExists(escrowId);

  const allEscrows = await getAllEscrows();
  assertEquals(allEscrows.length, 1);
  assertEquals(allEscrows[0].id, escrowId);
  assertEquals(allEscrows[0].senderAddress, sender);
  assertEquals(allEscrows[0].recipientAddress, recipient);
  assertEquals(allEscrows[0].amount, 10_000_000n);
  assertEquals(allEscrows[0].status, EscrowStatus.HELD);
});

Deno.test("createEscrow - rejects zero amount", async () => {
  await ensureInitialized();
  await resetDb();

  await assertRejects(
    () =>
      createEscrow({
        councilId: "default",
        senderAddress: testAddress(),
        recipientAddress: testAddress(),
        amount: 0n,
        assetCode: "XLM",
        channelContractId: testContractId(),
        submittedByProvider: Keypair.random().publicKey(),
      }),
    Error,
    "Amount must be positive",
  );
});

// ── getEscrowSummary ─────────────────────────────────────────────────────

Deno.test("getEscrowSummary - returns correct count and total for held escrows", async () => {
  await ensureInitialized();
  await resetDb();

  const recipient = testAddress();

  await seedEscrow({
    recipientAddress: recipient,
    amount: 5_000_000n,
    status: EscrowStatus.HELD,
  });
  await seedEscrow({
    recipientAddress: recipient,
    amount: 3_000_000n,
    status: EscrowStatus.HELD,
  });
  await seedEscrow({
    recipientAddress: recipient,
    amount: 1_000_000n,
    status: EscrowStatus.RELEASED,
  });

  const summary = await getEscrowSummary(recipient);
  assertEquals(summary.pendingCount, 2);
  assertEquals(summary.pendingTotal, 8_000_000n);
  assertEquals(summary.escrows.length, 2);
});

Deno.test("getEscrowSummary - returns 0 for address with no escrows", async () => {
  await ensureInitialized();
  await resetDb();

  const summary = await getEscrowSummary(testAddress());
  assertEquals(summary.pendingCount, 0);
  assertEquals(summary.pendingTotal, 0n);
  assertEquals(summary.escrows.length, 0);
});

// ── getRecipientUtxos ────────────────────────────────────────────────────

Deno.test("getRecipientUtxos - returns registered=false for unregistered user", async () => {
  await setupCouncil();

  const result = await getRecipientUtxos(
    COUNCIL_ID,
    testAddress(),
    testContractId(),
    1,
  );
  assertEquals(result.registered, false);
  assertEquals(result.publicKeys.length, 0);
});

Deno.test("getRecipientUtxos - returns registered=true with public keys for registered user", async () => {
  await setupCouncil();

  const externalId = `user-${crypto.randomUUID().slice(0, 8)}`;
  const channelId = testContractId();

  await seedCustodialUser({
    externalId,
    channelContractId: channelId,
    status: CustodialUserStatus.ACTIVE,
  });

  const result = await getRecipientUtxos(COUNCIL_ID, externalId, channelId, 2);
  assertEquals(result.registered, true);
  assertEquals(result.publicKeys.length, 2);

  // Each key should be a hex-encoded uncompressed P256 public key (65 bytes = 130 hex chars)
  for (const pk of result.publicKeys) {
    assertEquals(pk.length, 130);
    assertEquals(pk.startsWith("04"), true);
  }
});

// ── releaseEscrowsForRecipient ───────────────────────────────────────────

Deno.test("releaseEscrowsForRecipient - marks escrows as RELEASED and deducts fee", async () => {
  await ensureInitialized();
  await resetDb();

  const recipient = `user-${crypto.randomUUID().slice(0, 8)}`;
  const channelId = testContractId();

  await seedCustodialUser({
    externalId: recipient,
    channelContractId: channelId,
    status: CustodialUserStatus.ACTIVE,
  });

  const escrowAmount = 10_000_000n;
  await seedEscrow({
    recipientAddress: recipient,
    amount: escrowAmount,
    channelContractId: channelId,
    status: EscrowStatus.HELD,
  });
  await seedEscrow({
    recipientAddress: recipient,
    amount: 5_000_000n,
    channelContractId: channelId,
    status: EscrowStatus.HELD,
  });

  const result = await releaseEscrowsForRecipient(recipient, channelId);

  assertEquals(result.released, 2);
  assertEquals(result.totalFees, DEFAULT_ESCROW_FEE * 2n);
  assertEquals(
    result.totalReleased,
    (escrowAmount - DEFAULT_ESCROW_FEE) + (5_000_000n - DEFAULT_ESCROW_FEE),
  );

  // Verify DB state
  const allEscrows = await getAllEscrows();
  for (const e of allEscrows) {
    assertEquals(e.status, EscrowStatus.RELEASED);
  }
});

Deno.test("releaseEscrowsForRecipient - returns 0 when no held escrows exist", async () => {
  await ensureInitialized();
  await resetDb();

  const recipient = `user-${crypto.randomUUID().slice(0, 8)}`;
  const channelId = testContractId();

  await seedCustodialUser({
    externalId: recipient,
    channelContractId: channelId,
    status: CustodialUserStatus.ACTIVE,
  });

  const result = await releaseEscrowsForRecipient(recipient, channelId);
  assertEquals(result.released, 0);
  assertEquals(result.totalReleased, 0n);
  assertEquals(result.totalFees, 0n);
});

Deno.test("releaseEscrowsForRecipient - throws for unregistered recipient", async () => {
  await ensureInitialized();
  await resetDb();

  const recipient = testAddress();
  const channelId = testContractId();

  // Seed a held escrow so the function doesn't short-circuit with 0
  await seedEscrow({
    recipientAddress: recipient,
    channelContractId: channelId,
    status: EscrowStatus.HELD,
  });

  await assertRejects(
    () => releaseEscrowsForRecipient(recipient, channelId),
    Error,
    "Recipient is not registered or not active",
  );
});

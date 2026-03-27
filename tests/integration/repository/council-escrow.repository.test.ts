/**
 * Integration tests for CouncilEscrowRepository.
 *
 * Run with: deno test --allow-all --config tests/deno.json tests/integration/repository/council-escrow.repository.test.ts
 */
import { assertEquals } from "@std/assert";
import { CouncilEscrowRepository } from "@/persistence/drizzle/repository/council-escrow.repository.ts";
import {
  drizzleClient,
  resetDb,
  ensureInitialized,
  seedEscrow,
  testAddress,
  testContractId,
  EscrowStatus,
} from "../../test_helpers.ts";
import { Keypair } from "stellar-sdk";

const repo = new CouncilEscrowRepository(drizzleClient);

Deno.test("create - inserts escrow", async () => {
  await ensureInitialized();
  await resetDb();

  const result = await repo.create({
    id: crypto.randomUUID(),
    senderAddress: testAddress(),
    recipientAddress: testAddress(),
    amount: 5000n,
    assetCode: "XLM",
    channelContractId: testContractId(),
    status: EscrowStatus.HELD,
    submittedByProvider: Keypair.random().publicKey(),
  });

  assertEquals(result.amount, 5000n);
  assertEquals(result.status, EscrowStatus.HELD);
});

Deno.test("findHeldForRecipient - returns only HELD escrows", async () => {
  await ensureInitialized();
  await resetDb();

  const recipient = testAddress();

  await seedEscrow({ recipientAddress: recipient, status: EscrowStatus.HELD, amount: 1000n });
  await seedEscrow({ recipientAddress: recipient, status: EscrowStatus.HELD, amount: 2000n });
  await seedEscrow({ recipientAddress: recipient, status: EscrowStatus.RELEASED, amount: 3000n });

  const held = await repo.findHeldForRecipient(recipient);
  assertEquals(held.length, 2);
  for (const e of held) {
    assertEquals(e.status, EscrowStatus.HELD);
  }
});

Deno.test("findHeldForRecipient - excludes other recipients", async () => {
  await ensureInitialized();
  await resetDb();

  const recipient1 = testAddress();
  const recipient2 = testAddress();

  await seedEscrow({ recipientAddress: recipient1, status: EscrowStatus.HELD });
  await seedEscrow({ recipientAddress: recipient2, status: EscrowStatus.HELD });

  const held = await repo.findHeldForRecipient(recipient1);
  assertEquals(held.length, 1);
  assertEquals(held[0].recipientAddress, recipient1);
});

Deno.test("findByRecipient - returns all escrows for recipient regardless of status", async () => {
  await ensureInitialized();
  await resetDb();

  const recipient = testAddress();

  await seedEscrow({ recipientAddress: recipient, status: EscrowStatus.HELD });
  await seedEscrow({ recipientAddress: recipient, status: EscrowStatus.RELEASED });
  await seedEscrow({ recipientAddress: recipient, status: EscrowStatus.EXPIRED });

  const all = await repo.findByRecipient(recipient);
  assertEquals(all.length, 3);
});

Deno.test("update - changes status from HELD to RELEASED", async () => {
  await ensureInitialized();
  await resetDb();

  const escrow = await seedEscrow({ status: EscrowStatus.HELD });

  const updated = await repo.update(escrow.id, { status: EscrowStatus.RELEASED });
  assertEquals(updated.status, EscrowStatus.RELEASED);
});

/**
 * Integration tests for ProviderJoinRequestRepository.
 *
 * Run with: deno test --allow-all --config tests/deno.json tests/integration/repository/provider-join-request.repository.test.ts
 */
import { assertEquals, assertExists } from "@std/assert";
import { ProviderJoinRequestRepository } from "@/persistence/drizzle/repository/provider-join-request.repository.ts";
import {
  drizzleClient,
  ensureInitialized,
  JoinRequestStatus,
  resetDb,
  seedJoinRequest,
} from "../../test_helpers.ts";
import { Keypair } from "stellar-sdk";

const repo = new ProviderJoinRequestRepository(drizzleClient);

Deno.test("create - inserts request with PENDING status", async () => {
  await ensureInitialized();
  await resetDb();

  const pk = Keypair.random().publicKey();
  const result = await repo.create({
    id: crypto.randomUUID(),
    councilId: "default",
    publicKey: pk,
    label: "New Provider",
    contactEmail: "new@example.com",
    status: JoinRequestStatus.PENDING,
  });

  assertEquals(result.status, "PENDING");
  assertEquals(result.publicKey, pk);
});

Deno.test("findPendingByPublicKey - returns pending request", async () => {
  await ensureInitialized();
  await resetDb();

  const pk = Keypair.random().publicKey();
  await seedJoinRequest({ publicKey: pk, status: JoinRequestStatus.PENDING });

  const found = await repo.findPendingByPublicKey("default", pk);
  assertExists(found);
  assertEquals(found.publicKey, pk);
  assertEquals(found.status, "PENDING");
});

Deno.test("findPendingByPublicKey - ignores approved/rejected requests", async () => {
  await ensureInitialized();
  await resetDb();

  const pk = Keypair.random().publicKey();
  await seedJoinRequest({ publicKey: pk, status: JoinRequestStatus.APPROVED });

  const found = await repo.findPendingByPublicKey("default", pk);
  assertEquals(found, undefined);
});

Deno.test("listPending - returns only pending requests", async () => {
  await ensureInitialized();
  await resetDb();

  await seedJoinRequest({
    publicKey: Keypair.random().publicKey(),
    status: JoinRequestStatus.PENDING,
  });
  await seedJoinRequest({
    publicKey: Keypair.random().publicKey(),
    status: JoinRequestStatus.PENDING,
  });
  await seedJoinRequest({
    publicKey: Keypair.random().publicKey(),
    status: JoinRequestStatus.APPROVED,
  });
  await seedJoinRequest({
    publicKey: Keypair.random().publicKey(),
    status: JoinRequestStatus.REJECTED,
  });

  const pending = await repo.listPending("default");
  assertEquals(pending.length, 2);
  for (const r of pending) {
    assertEquals(r.status, "PENDING");
  }
});

Deno.test("listAll - returns all non-deleted requests", async () => {
  await ensureInitialized();
  await resetDb();

  await seedJoinRequest({
    publicKey: Keypair.random().publicKey(),
    status: JoinRequestStatus.PENDING,
  });
  await seedJoinRequest({
    publicKey: Keypair.random().publicKey(),
    status: JoinRequestStatus.APPROVED,
  });
  await seedJoinRequest({
    publicKey: Keypair.random().publicKey(),
    status: JoinRequestStatus.REJECTED,
  });

  const all = await repo.listAll("default");
  assertEquals(all.length, 3);
});

Deno.test("update - changes status from PENDING to APPROVED", async () => {
  await ensureInitialized();
  await resetDb();

  const request = await seedJoinRequest({ status: JoinRequestStatus.PENDING });

  const updated = await repo.update(request.id, {
    status: JoinRequestStatus.APPROVED,
    reviewedAt: new Date(),
    reviewedBy: "admin-test",
  });
  assertEquals(updated.status, "APPROVED");
  assertExists(updated.reviewedAt);
});

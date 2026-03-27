/**
 * Integration tests for CustodialUserRepository.
 *
 * Run with: deno test --allow-all --config tests/deno.json tests/integration/repository/custodial-user.repository.test.ts
 */
import { assertEquals, assertExists } from "@std/assert";
import { CustodialUserRepository } from "@/persistence/drizzle/repository/custodial-user.repository.ts";
import {
  drizzleClient,
  resetDb,
  ensureInitialized,
  seedCustodialUser,
  testContractId,
  CustodialUserStatus,
} from "../../test_helpers.ts";

const repo = new CustodialUserRepository(drizzleClient);

const CONTRACT_A = "CCONTRACTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4";
const CONTRACT_B = "CCONTRACTBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBHK3M";

Deno.test("findByExternalIdAndChannel - returns correct user", async () => {
  await ensureInitialized();
  await resetDb();

  const user = await seedCustodialUser({
    externalId: "user-123",
    channelContractId: CONTRACT_A,
  });

  const found = await repo.findByExternalIdAndChannel("user-123", CONTRACT_A);
  assertExists(found);
  assertEquals(found.id, user.id);
  assertEquals(found.externalId, "user-123");
});

Deno.test("findByExternalIdAndChannel - returns undefined for wrong channel", async () => {
  await ensureInitialized();
  await resetDb();

  await seedCustodialUser({
    externalId: "user-456",
    channelContractId: CONTRACT_A,
  });

  const found = await repo.findByExternalIdAndChannel("user-456", CONTRACT_B);
  assertEquals(found, undefined);
});

Deno.test("listByChannel - returns users for a specific channel", async () => {
  await ensureInitialized();
  await resetDb();

  await seedCustodialUser({ externalId: "u1", channelContractId: CONTRACT_A });
  await seedCustodialUser({ externalId: "u2", channelContractId: CONTRACT_A });
  await seedCustodialUser({ externalId: "u3", channelContractId: CONTRACT_B });

  const usersA = await repo.listByChannel(CONTRACT_A);
  assertEquals(usersA.length, 2);

  const usersB = await repo.listByChannel(CONTRACT_B);
  assertEquals(usersB.length, 1);
});

Deno.test("create - inserts user", async () => {
  await ensureInitialized();
  await resetDb();

  const result = await repo.create({
    id: crypto.randomUUID(),
    externalId: "new-user",
    channelContractId: CONTRACT_A,
    p256PublicKeyHex: "04" + "ab".repeat(64),
    status: CustodialUserStatus.ACTIVE,
  });

  assertEquals(result.externalId, "new-user");
  assertEquals(result.status, "ACTIVE");
});

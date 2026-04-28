/**
 * Integration tests for CouncilMetadataRepository.
 *
 * Run with: deno test --allow-all --config tests/deno.json tests/integration/repository/council-metadata.repository.test.ts
 */
import { assertEquals } from "@std/assert";
import { CouncilMetadataRepository } from "@/persistence/drizzle/repository/council-metadata.repository.ts";
import { encryptSecret } from "@/core/crypto/encrypt-secret.ts";
import { SERVICE_AUTH_SECRET } from "@/config/env.ts";
import {
  ADMIN_KEYPAIR,
  drizzleClient,
  ensureInitialized,
  getAllChannels,
  getAllJoinRequests,
  getAllProviders,
  getMetadata,
  resetDb,
  seedChannel,
  seedCouncilMetadata,
  seedJoinRequest,
  seedProvider,
} from "../../test_helpers.ts";

const repo = new CouncilMetadataRepository(drizzleClient);

// Helper to mint a real encrypted root for direct repo tests.
async function makeEncryptedRoot(): Promise<string> {
  const root = crypto.getRandomValues(new Uint8Array(32));
  return await encryptSecret(root, SERVICE_AUTH_SECRET);
}

Deno.test("getById - returns undefined on empty DB", async () => {
  await ensureInitialized();
  await resetDb();

  const result = await repo.getById("default");
  assertEquals(result, undefined);
});

Deno.test("upsert - creates a new record", async () => {
  await ensureInitialized();
  await resetDb();

  const encryptedDerivationRoot = await makeEncryptedRoot();
  const result = await repo.upsert("default", {
    name: "Test Council",
    description: "A test council",
    contactEmail: "test@example.com",
    councilPublicKey: ADMIN_KEYPAIR.publicKey(),
    encryptedDerivationRoot,
  });

  assertEquals(result.id, "default");
  assertEquals(result.name, "Test Council");
  assertEquals(result.description, "A test council");
});

Deno.test("upsert - updates existing record (singleton)", async () => {
  await ensureInitialized();
  await resetDb();

  const encryptedDerivationRoot = await makeEncryptedRoot();
  await repo.upsert("default", {
    name: "Original Name",
    councilPublicKey: ADMIN_KEYPAIR.publicKey(),
    encryptedDerivationRoot,
  });

  // Update payload carries the existing derivation root through so
  // the ON CONFLICT insert row satisfies the NOT NULL constraint.
  const updated = await repo.upsert("default", {
    name: "Updated Name",
    councilPublicKey: ADMIN_KEYPAIR.publicKey(),
    encryptedDerivationRoot,
  });

  assertEquals(updated.id, "default");
  assertEquals(updated.name, "Updated Name");

  // Should still be exactly one record
  const config = await repo.getById("default");
  assertEquals(config?.name, "Updated Name");
});

Deno.test("deleteCouncil - cascades across council tables", async () => {
  await ensureInitialized();
  await resetDb();

  // Seed data in council-owned tables
  await seedCouncilMetadata();
  await seedChannel();
  await seedProvider();
  await seedJoinRequest();

  // Verify data exists
  const metaBefore = await getMetadata();
  assertEquals(metaBefore !== undefined, true);

  // Delete all
  await repo.deleteCouncil("default");

  // Verify council tables are empty
  const metaAfter = await getMetadata();
  assertEquals(metaAfter, undefined);
  assertEquals((await getAllChannels()).length, 0);
  assertEquals((await getAllProviders()).length, 0);
  assertEquals((await getAllJoinRequests()).length, 0);
});

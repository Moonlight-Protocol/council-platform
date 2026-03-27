/**
 * Integration tests for CouncilMetadataRepository.
 *
 * Run with: deno test --allow-all --config tests/deno.json tests/integration/repository/council-metadata.repository.test.ts
 */
import { assertEquals } from "@std/assert";
import { CouncilMetadataRepository } from "@/persistence/drizzle/repository/council-metadata.repository.ts";
import {
  drizzleClient,
  resetDb,
  ensureInitialized,
  seedCouncilMetadata,
  seedChannel,
  seedProvider,
  seedJoinRequest,
  seedEscrow,
  seedCustodialUser,
  getMetadata,
  getAllChannels,
  getAllProviders,
  getAllEscrows,
  getAllJoinRequests,
  ADMIN_KEYPAIR,
} from "../../test_helpers.ts";

const repo = new CouncilMetadataRepository(drizzleClient);

Deno.test("getConfig - returns undefined on empty DB", async () => {
  await ensureInitialized();
  await resetDb();

  const result = await repo.getConfig();
  assertEquals(result, undefined);
});

Deno.test("upsert - creates a new record", async () => {
  await ensureInitialized();
  await resetDb();

  const result = await repo.upsert({
    name: "Test Council",
    description: "A test council",
    contactEmail: "test@example.com",
    channelAuthId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4",
    councilPublicKey: ADMIN_KEYPAIR.publicKey(),
  });

  assertEquals(result.id, "default");
  assertEquals(result.name, "Test Council");
  assertEquals(result.description, "A test council");
});

Deno.test("upsert - updates existing record (singleton)", async () => {
  await ensureInitialized();
  await resetDb();

  await repo.upsert({
    name: "Original Name",
    channelAuthId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4",
    councilPublicKey: ADMIN_KEYPAIR.publicKey(),
  });

  const updated = await repo.upsert({
    name: "Updated Name",
    channelAuthId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4",
    councilPublicKey: ADMIN_KEYPAIR.publicKey(),
  });

  assertEquals(updated.id, "default");
  assertEquals(updated.name, "Updated Name");

  // Should still be exactly one record
  const config = await repo.getConfig();
  assertEquals(config?.name, "Updated Name");
});

Deno.test("deleteAll - cascades across all tables", async () => {
  await ensureInitialized();
  await resetDb();

  // Seed data in all tables
  await seedCouncilMetadata();
  await seedChannel();
  await seedProvider();
  await seedJoinRequest();
  await seedEscrow();
  await seedCustodialUser();

  // Verify data exists
  const metaBefore = await getMetadata();
  assertEquals(metaBefore !== undefined, true);

  // Delete all
  await repo.deleteAll();

  // Verify all tables are empty
  const metaAfter = await getMetadata();
  assertEquals(metaAfter, undefined);
  assertEquals((await getAllChannels()).length, 0);
  assertEquals((await getAllProviders()).length, 0);
  assertEquals((await getAllEscrows()).length, 0);
  assertEquals((await getAllJoinRequests()).length, 0);
});

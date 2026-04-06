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
  getMetadata,
  getAllChannels,
  getAllProviders,
  getAllJoinRequests,
  ADMIN_KEYPAIR,
} from "../../test_helpers.ts";

const repo = new CouncilMetadataRepository(drizzleClient);

Deno.test("getById - returns undefined on empty DB", async () => {
  await ensureInitialized();
  await resetDb();

  const result = await repo.getById("default");
  assertEquals(result, undefined);
});

Deno.test("upsert - creates a new record", async () => {
  await ensureInitialized();
  await resetDb();

  const result = await repo.upsert("default", {
    name: "Test Council",
    description: "A test council",
    contactEmail: "test@example.com",
    councilPublicKey: ADMIN_KEYPAIR.publicKey(),
  });

  assertEquals(result.id, "default");
  assertEquals(result.name, "Test Council");
  assertEquals(result.description, "A test council");
});

Deno.test("upsert - updates existing record (singleton)", async () => {
  await ensureInitialized();
  await resetDb();

  await repo.upsert("default", {
    name: "Original Name",
    councilPublicKey: ADMIN_KEYPAIR.publicKey(),
  });

  const updated = await repo.upsert("default", {
    name: "Updated Name",
    councilPublicKey: ADMIN_KEYPAIR.publicKey(),
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

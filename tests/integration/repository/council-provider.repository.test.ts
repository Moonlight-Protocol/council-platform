/**
 * Integration tests for CouncilProviderRepository.
 *
 * Run with: deno test --allow-all --config tests/deno.json tests/integration/repository/council-provider.repository.test.ts
 */
import { assertEquals, assertExists } from "@std/assert";
import { CouncilProviderRepository } from "@/persistence/drizzle/repository/council-provider.repository.ts";
import {
  drizzleClient,
  ensureInitialized,
  PROVIDER_KEYPAIR,
  ProviderStatus,
  resetDb,
  seedProvider,
} from "../../test_helpers.ts";
import { Keypair } from "stellar-sdk";

const repo = new CouncilProviderRepository(drizzleClient);

Deno.test("findByPublicKey - returns correct provider", async () => {
  await ensureInitialized();
  await resetDb();

  const pk = PROVIDER_KEYPAIR.publicKey();
  const provider = await seedProvider({ publicKey: pk });

  const found = await repo.findByPublicKey("default", pk);
  assertExists(found);
  assertEquals(found.id, provider.id);
  assertEquals(found.publicKey, pk);
});

Deno.test("findByPublicKey - returns undefined for non-existent", async () => {
  await ensureInitialized();
  await resetDb();

  const found = await repo.findByPublicKey(
    "default",
    Keypair.random().publicKey(),
  );
  assertEquals(found, undefined);
});

Deno.test("listActive - returns only ACTIVE providers", async () => {
  await ensureInitialized();
  await resetDb();

  await seedProvider({
    publicKey: Keypair.random().publicKey(),
    status: ProviderStatus.ACTIVE,
  });
  await seedProvider({
    publicKey: Keypair.random().publicKey(),
    status: ProviderStatus.ACTIVE,
  });
  await seedProvider({
    publicKey: Keypair.random().publicKey(),
    status: ProviderStatus.REMOVED,
  });

  const active = await repo.listActive("default");
  assertEquals(active.length, 2);
  for (const p of active) {
    assertEquals(p.status, "ACTIVE");
  }
});

Deno.test("listAll - returns all non-deleted providers", async () => {
  await ensureInitialized();
  await resetDb();

  await seedProvider({
    publicKey: Keypair.random().publicKey(),
    status: ProviderStatus.ACTIVE,
  });
  await seedProvider({
    publicKey: Keypair.random().publicKey(),
    status: ProviderStatus.REMOVED,
  });

  const all = await repo.listAll("default");
  assertEquals(all.length, 2);
});

Deno.test("update - modifies fields", async () => {
  await ensureInitialized();
  await resetDb();

  const provider = await seedProvider({ label: "Original" });

  const updated = await repo.update(provider.id, { label: "Updated" });
  assertEquals(updated.label, "Updated");
});
